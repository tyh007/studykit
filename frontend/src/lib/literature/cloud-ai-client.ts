export interface CloudAIService {
  extractWithFallback(
    paperText: string,
    detailLevel?: 'brief' | 'detailed',
    customFields?: any[]
  ): Promise<{ extractedData: any; method: string }>
}

class GeminiService implements CloudAIService {
  async extractWithFallback(
    paperText: string,
    detailLevel: 'brief' | 'detailed' = 'brief',
    customFields?: any[]
  ): Promise<{ extractedData: any; method: string }> {
    try {
      const response = await fetch('/api/literature/ai/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperText, detailLevel, customFields })
      })
      if (!response.ok) throw new Error(`Gemini API error: ${response.status}`)
      const data = await response.json()
      if (!data.success) throw new Error(data.error || 'Gemini extraction failed')
      return { extractedData: data.extractedData, method: 'Gemini' }
    } catch (err) {
      console.error('Gemini extraction failed:', err)
      throw err
    }
  }
}

export class CloudAIServiceFactory {
  static createGeminiService(): CloudAIService {
    return new GeminiService()
  }
}
