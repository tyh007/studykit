import type { ExtractedData, CustomFieldDefinition } from './types'

export interface AIExtractionService {
  extractWithFallback(
    paperText: string,
    detailLevel?: 'brief' | 'detailed',
    customFields?: CustomFieldDefinition[]
  ): Promise<{ extractedData: ExtractedData; method: string }>
}
