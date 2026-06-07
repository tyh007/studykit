
export interface CustomAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CustomAIRequest {
  model: string
  messages: CustomAIMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
  response_format?: { type: 'json_object' | 'text' }
}

export interface CustomAIResponse {
  id: string
  object: string
  created: number
  model: string
  choices: {
    index: number
    message: {
      role: 'assistant'
      content: string
    }
    finish_reason: string
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface CustomAIModel {
  id: string
  object: string
  created: number
  owned_by: string
}

export class CustomAIClient {
  private baseUrl: string
  private defaultModel: string
  private apiKey: string

  constructor(baseUrl: string = 'http://localhost:1234/v1', defaultModel: string = '', apiKey: string = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.defaultModel = defaultModel
    this.apiKey = apiKey
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    return headers
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders()
      })
      return response.ok
    } catch {
      return false
    }
  }

  async getAvailableModels(): Promise<CustomAIModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders()
      })
      const data = await response.json()
      return data.data || []
    } catch (error) {
      console.error('Failed to get available models:', error)
      throw error
    }
  }

  async chat(request: CustomAIRequest): Promise<CustomAIResponse> {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.max_tokens ?? 2000,
      stream: request.stream ?? false
    }

    if (request.response_format) {
      body.response_format = request.response_format
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`API error ${response.status}: ${errText}`)
    }

    return response.json() as Promise<CustomAIResponse>
  }

  async generateText(
    prompt: string,
    model?: string,
    options?: { temperature?: number; max_tokens?: number }
  ): Promise<string> {
    const response = await this.chat({
      model: model || this.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      ...options
    })
    return response.choices[0]?.message?.content || ''
  }

  async chatForJson(
    systemPrompt: string,
    userPrompt: string,
    model?: string
  ): Promise<{ parsed: Record<string, unknown>; model: string }> {
    const resolvedModel = model || this.defaultModel

    const response = await this.chat({
      model: resolvedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5,
      max_tokens: 4096,
      stream: false,
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0]?.message?.content || ''
    const cleaned = this.sanitizeResponse(content)
    let parsed: Record<string, unknown>

    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>
    } catch (error) {
      const loose = this.tryLooseFieldExtraction(cleaned)
      if (loose) {
        parsed = loose
        return { parsed, model: response.model || resolvedModel }
      }
      throw new Error(
        `Custom AI returned non-JSON output. Preview: ${content.slice(0, 300)}${content.length >= 300 ? '...' : ''}`
      )
    }

    return { parsed, model: response.model || resolvedModel }
  }

  private sanitizeResponse(response: string): string {
    let cleaned = response.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }
    // Scan forward to find every valid JSON object, return the first one that parses
    let depth = 0
    let start = -1
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        if (depth === 0) start = i
        depth++
      } else if (cleaned[i] === '}') {
        depth--
        if (depth === 0 && start !== -1) {
          const candidate = cleaned.substring(start, i + 1)
          try {
            JSON.parse(candidate)
            return candidate
          } catch {
            // This wasn't a valid JSON object, keep scanning
            start = -1
          }
        }
      }
    }
    return cleaned
  }

  private tryLooseFieldExtraction(raw: string): Record<string, unknown> | null {
    const result: Record<string, unknown> = {}
    const fields = ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations']
    for (const field of fields) {
      const pattern = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?:\\s*,\\s*"|\\s*\\})`, 'i')
      const match = raw.match(pattern)
      if (match?.[1]) {
        result[field] = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/  +/g, ' ')
          .trim()
      }
    }
    return Object.keys(result).length >= 4 ? result : null
  }
}
