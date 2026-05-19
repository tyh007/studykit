export class GeminiClient {
  private apiKey: string
  private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async generateContent(prompt: string, options?: { temperature?: number; maxOutputTokens?: number }): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options?.temperature ?? 0.3,
            maxOutputTokens: options?.maxOutputTokens ?? 4096
          }
        })
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Gemini API error: ${response.status} - ${errText}`)
    }

    const data = await response.json()
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }
}
