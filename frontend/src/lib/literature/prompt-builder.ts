import type { ExtractedData } from './types'
import type { CustomFieldDefinition } from './types'

export interface ExtractionPrompt {
  systemPrompt: string
  userPrompt: string
  expectedFields: string[]
}

export class PromptBuilder {
  private static readonly FIELD_GUIDANCE: Record<string, string> = {
    background: 'Summarize the research context, problem statement, motivation, and why the study matters. What gap does it address?',
    theory: 'Summarize the theoretical framework, key hypotheses, and core concepts the study builds on.',
    methodology: 'Summarize research design, sample size, participants, study procedures, and analytical methods used.',
    measures: 'List the scales, instruments, tasks, questionnaires, or operational definitions used. If not mentioned, say "Not mentioned".',
    results: 'Summarize main findings, key statistics, effect sizes, and outcomes. Focus on what the study actually found.',
    implications: 'Summarize theoretical contributions, practical applications, and what the findings mean for the field.',
    limitations: 'Summarize study limitations, caveats, generalizability concerns, and future research directions noted.'
  }

  private static readonly BASE_SYSTEM_PROMPT = `You are an AI research assistant. Extract key information from academic papers into short bullet points.

Strict rules:
1. Extract ONLY from the paper text — do not make up or guess
2. If a field has no information, respond with exactly: "Not mentioned"
3. Each bullet = ONE sentence. Maximum 20 words per bullet.
4. 2-4 bullets per field maximum
5. Each field must have UNIQUE content — no repeating across fields
6. Use the paper's own terminology and specific numbers/statistics when available
7. All 7 fields MUST be in the output — use "Not mentioned" for empty fields`

  private static readonly BRIEF_MODE_INSTRUCTIONS = `Keep each bullet to ONE short sentence (10-20 words). Be direct.
Format each bullet starting with • on its own line.

Correct (short, one fact per bullet):
• Social Simon Effect: irrelevant spatial info interferes in joint tasks.
• Prior group membership studies gave conflicting results.

Wrong (too long, multiple ideas in one bullet):
• This reflects The second factor that we discussed in the introduction the extra computational demands in mentally representing the concerned the potential role of motivation due to inherent social partner's actions simultaneously with one's own.`

  private static readonly DETAILED_MODE_INSTRUCTIONS = `Provide detailed bullet points with specific statistics, methodological details, and nuanced findings. Each bullet should still be ONE sentence.`

  static buildExtractionPrompt(
    paperText: string,
    detailLevel: 'brief' | 'detailed' = 'brief',
    customFields?: CustomFieldDefinition[]
  ): ExtractionPrompt {
    const modeInstructions = detailLevel === 'brief'
      ? this.BRIEF_MODE_INSTRUCTIONS
      : this.DETAILED_MODE_INSTRUCTIONS

    const systemPrompt = `${this.BASE_SYSTEM_PROMPT}

${modeInstructions}

Please extract the following information from the paper and respond with a valid JSON object containing these exact fields:`

    const fields = [
      'background',
      'theory',
      'methodology',
      'measures',
      'results',
      'implications',
      'limitations'
    ]

    let fieldDescriptions = `
Fields to fill:
- background: ${this.FIELD_GUIDANCE.background}
- theory: ${this.FIELD_GUIDANCE.theory}
- methodology: ${this.FIELD_GUIDANCE.methodology}
- measures: ${this.FIELD_GUIDANCE.measures}
- results: ${this.FIELD_GUIDANCE.results}
- implications: ${this.FIELD_GUIDANCE.implications}
- limitations: ${this.FIELD_GUIDANCE.limitations}`

    if (customFields && customFields.length > 0) {
      customFields.forEach(field => {
        fields.push(field.id)
        fieldDescriptions += `
- ${field.id}: ${field.description}`
      })
    }

    const outputTemplate = JSON.stringify(
      Object.fromEntries(fields.map(field => [field, ''])),
      null,
      2
    )

    const userPrompt = `Extract key information from this paper into short, one-sentence bullet points per field:

${paperText}

${fieldDescriptions}

Return valid JSON with ALL 7 fields using these exact keys:
${outputTemplate}

Format each field as bullet points (•) separated by \\n.
Example for a field with content:
  "background": "• Participants were 64 female students in minimal groups.\\n• Social Simon effect tested with compatible vs incompatible trials."

If a field has no information, use exactly: "Not mentioned"
Do NOT wrap in markdown code blocks.
Each bullet = ONE sentence (max 20 words).
IMPORTANT: All 7 fields must be present in the output JSON.`

    return {
      systemPrompt,
      userPrompt,
      expectedFields: fields
    }
  }

  static buildCustomFieldPrompt(
    paperText: string,
    customField: CustomFieldDefinition,
    detailLevel: 'brief' | 'detailed' = 'brief'
  ): string {
    const modeInstructions = detailLevel === 'brief'
      ? 'Provide a concise response focusing on the most relevant information (1-2 sentences maximum).'
      : 'Provide a detailed, comprehensive response with specific examples and details from the text.'

    return `${this.BASE_SYSTEM_PROMPT}

${modeInstructions}

Custom Field: ${customField.name}
Description: ${customField.description}

${customField.prompt}

Please analyze the following psychology research paper text and extract information related to the custom field above:

${paperText}

Respond with the extracted information only. Do not include explanations or formatting.`
  }

  static buildReExtractionPrompt(
    paperText: string,
    existingExtraction: ExtractedData,
    fieldsToUpdate: string[],
    detailLevel: 'brief' | 'detailed' = 'brief'
  ): ExtractionPrompt {
    const modeInstructions = detailLevel === 'brief'
      ? this.BRIEF_MODE_INSTRUCTIONS
      : this.DETAILED_MODE_INSTRUCTIONS

    const systemPrompt = `${this.BASE_SYSTEM_PROMPT}

${modeInstructions}

You are updating an existing extraction for a psychology research paper. Please focus only on the specified fields and provide improved, more accurate information.

Fields to update: ${fieldsToUpdate.join(', ')}

Current extraction data:
${JSON.stringify(existingExtraction, null, 2)}

Please respond with a complete JSON object containing all original fields with updates for the specified fields only.`

    const userPrompt = `Please re-analyze the following psychology research paper text and provide improved extractions for the specified fields:

${paperText}

Focus on providing more accurate, detailed information for: ${fieldsToUpdate.join(', ')}

Respond with valid JSON only. Include all fields from the original extraction with improvements for the specified fields.`

    return {
      systemPrompt,
      userPrompt,
      expectedFields: Object.keys(existingExtraction)
    }
  }

  static buildCrossPaperAnalysisPrompt(
    papers: Array<{
      title: string
      authors: string
      year: number
      extractedData: ExtractedData
    }>,
    analysisQuestion: string
  ): string {
    const papersText = papers.map((paper, index) => `
Paper ${index + 1}:
Title: ${paper.title}
Authors: ${paper.authors}
Year: ${paper.year}
Background: ${paper.extractedData.background}
Theory: ${paper.extractedData.theory}
Methodology: ${paper.extractedData.methodology}
Measures: ${paper.extractedData.measures}
Results: ${paper.extractedData.results}
Implications: ${paper.extractedData.implications}
Limitations: ${paper.extractedData.limitations}
`).join('\n---\n')

    return `${this.BASE_SYSTEM_PROMPT}

You are conducting a cross-paper analysis of multiple psychology research studies. Please analyze the following papers and answer the specific research question.

Research Question: ${analysisQuestion}

${papersText}

Please provide a comprehensive analysis that:
1. Synthesizes findings across all papers
2. Identifies patterns, contradictions, or gaps
3. Highlights methodological differences that might explain variations
4. Suggests implications for theory or practice

Provide your analysis in a structured, academic format with clear sections.`
  }

  static buildMethodologyComparisonPrompt(
    papers: Array<{
      title: string
      methodology: string
      measures: string
      results: string
    }>
  ): string {
    const methodologiesText = papers.map((paper, index) => `
Study ${index + 1}: ${paper.title}
Methodology: ${paper.methodology}
Measures: ${paper.measures}
Results: ${paper.results}
`).join('\n---\n')

    return `${this.BASE_SYSTEM_PROMPT}

Please conduct a detailed methodological comparison of the following psychology studies:

${methodologiesText}

Focus on:
1. Research designs and their strengths/limitations
2. Sample characteristics and sizes
3. Measurement approaches and psychometric properties
4. Statistical analyses used
5. How methodological differences might explain variations in findings

Provide a structured comparison table and narrative analysis.`
  }

  static validatePromptResponse(response: string, expectedFields: string[]): boolean {
    try {
      const parsed = JSON.parse(response)
      return expectedFields.every(field => field in parsed)
    } catch {
      return false
    }
  }

  static sanitizeResponse(response: string): string {
    let cleaned = response.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }
    const jsonStart = cleaned.indexOf('{')
    const jsonEnd = cleaned.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1)
    }
    return cleaned
  }
}

export const PSYCHOLOGY_CUSTOM_FIELDS: CustomFieldDefinition[] = [
  {
    id: 'sample_demographics',
    name: 'Sample Demographics',
    description: 'Detailed demographic information about study participants',
    prompt: 'Extract detailed demographic information including age ranges, gender distribution, ethnicity, education level, and any other relevant participant characteristics.'
  },
  {
    id: 'effect_sizes',
    name: 'Effect Sizes',
    description: 'Statistical effect sizes and their interpretation',
    prompt: 'Extract all reported effect sizes (Cohen\'s d, r, η², etc.) with their values and interpretation according to conventional standards.'
  },
  {
    id: 'statistical_tests',
    name: 'Statistical Tests',
    description: 'Specific statistical tests and their results',
    prompt: 'List all statistical tests performed (t-tests, ANOVA, regression, etc.) with test statistics, degrees of freedom, p-values, and confidence intervals.'
  },
  {
    id: 'theoretical_contributions',
    name: 'Theoretical Contributions',
    description: 'How the study contributes to theory development',
    prompt: 'Extract specific theoretical contributions and how this study advances, refutes, or extends existing theories in the field.'
  },
  {
    id: 'practical_applications',
    name: 'Practical Applications',
    description: 'Real-world applications and implications',
    prompt: 'Extract practical applications, clinical implications, or real-world relevance of the research findings.'
  }
]
