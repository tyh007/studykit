import type { ExtractedData } from './types'

interface GroqMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class GroqClient {
  private apiKey: string
  private baseUrl = 'https://api.groq.com/openai/v1'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async chat(messages: GroqMessage[], options?: { model?: string; temperature?: number; maxTokens?: number }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options?.model || 'llama3-70b-8192',
        messages,
        temperature: options?.temperature ?? 0.1,
        max_tokens: options?.maxTokens ?? 2000
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Groq API error: ${response.status} - ${errText}`)
    }

    return response.json()
  }

  async extractPaper(text: string): Promise<ExtractedData> {
    const messages: GroqMessage[] = [
      {
        role: 'system',
        content: `You are a research paper analyzer. Extract structured information from the paper text and return ONLY valid JSON with these keys: background, theory, methodology, measures, results, implications, limitations.`
      },
      {
        role: 'user',
        content: `Extract the following information from this paper:\n\n${text}\n\nReturn valid JSON.`
      }
    ]

    const data = await this.chat(messages, { temperature: 0.1 })
    const content = data.choices?.[0]?.message?.content || ''

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)
    } catch {
      throw new Error('Failed to parse Groq response')
    }
  }
}
