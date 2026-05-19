import type { ExtractedData } from './types'
import type { CustomFieldDefinition } from './types'

export type PaperType = 'A' | 'B' | 'C'

export interface FieldDefinition {
  key: string
  label: string
  definitionA: string
  definitionB: string
  definitionC: string
  sourceScope: string
  antiExample: string
  maxWords: number
  maxBullets: number
}

const EXTRACTION_FIELDS: FieldDefinition[] = [
  {
    key: 'background',
    label: 'Background',
    definitionA: 'Research context, problem statement, gap this study addresses',
    definitionB: 'Review topic, scope, rationale for why this review matters',
    definitionC: 'Research question, theoretical context, motivation for the meta-analysis',
    sourceScope: 'Abstract, Introduction',
    antiExample: 'Individual study findings, methodology details, or results',
    maxWords: 60,
    maxBullets: 3,
  },
  {
    key: 'theory',
    label: 'Theory & Hypotheses',
    definitionA: 'Theoretical framework, key concepts, specific hypotheses tested',
    definitionB: 'Central thesis, organizing framework, core argument of the review',
    definitionC: 'Theoretical model, moderator variables examined, predictions about effect variation',
    sourceScope: 'Introduction, Theory sections, end of Introduction',
    antiExample: 'Background context, methodology, or individual study findings',
    maxWords: 60,
    maxBullets: 3,
  },
  {
    key: 'methodology',
    label: 'Methodology',
    definitionA: 'Research design, sample (size, characteristics), procedures, conditions, analytical approach',
    definitionB: 'Search strategy, databases, scope of literature covered (or "Not mentioned" if absent)',
    definitionC: 'Databases searched, inclusion/exclusion criteria, screening process, number of screened/included studies',
    sourceScope: 'Methods/Methodology section',
    antiExample: 'Results, instruments, statistical tests, or theoretical framework',
    maxWords: 80,
    maxBullets: 3,
  },
  {
    key: 'measures',
    label: 'Measures',
    definitionA: 'Specific instruments, scales, tasks, questionnaires used to collect data',
    definitionB: 'Key themes, dimensions, categories used to organize and structure the review',
    definitionC: 'Number of studies (k), total participants (N), range of years, types of studies included',
    sourceScope: 'Measures/Materials subsection (A), thematic structure (B), study selection (C)',
    antiExample: 'Participant demographics, procedure steps, effect sizes, or statistical results',
    maxWords: 60,
    maxBullets: 3,
  },
  {
    key: 'results',
    label: 'Results',
    definitionA: 'Main findings, key statistics, effect sizes, significance values, direction of effects',
    definitionB: '3-5 representative findings from cited studies, each as a one-line summary per study',
    definitionC: 'Overall effect size with confidence interval, heterogeneity statistics, key moderator effects',
    sourceScope: 'Results section',
    antiExample: 'Discussion, interpretation, implications, or methodology (for B: NOT background or thesis)',
    maxWords: 100,
    maxBullets: 4,
  },
  {
    key: 'implications',
    label: 'Implications',
    definitionA: 'Theoretical contributions, practical applications, what findings mean for the field',
    definitionB: 'Synthesis the review offers, theoretical contributions, what the literature collectively shows',
    definitionC: 'What the meta-analytic findings mean for theory and practice',
    sourceScope: 'Discussion, Conclusion',
    antiExample: 'Repeating results, listing limitations, or individual study findings',
    maxWords: 60,
    maxBullets: 3,
  },
  {
    key: 'limitations',
    label: 'Limitations',
    definitionA: 'Study limitations, caveats, generalizability concerns, future research directions',
    definitionB: 'Research gaps, what remains unknown, limitations of the existing literature, future directions',
    definitionC: 'Limitations of the meta-analysis, publication bias, generalizability concerns',
    sourceScope: 'Limitations section, end of Discussion',
    antiExample: 'Results, main implications, or specific study findings',
    maxWords: 60,
    maxBullets: 3,
  },
]

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

  private static readonly BASE_SYSTEM_PROMPT = `You are an AI research assistant. Extract structured data from academic papers into concise bullet points.

STRICT RULES:
1. Extract ONLY from the paper text — do not make up or guess
2. If a field has no applicable content for this paper type, respond with exactly: "Not mentioned"
3. Each bullet = ONE short sentence (10-20 words maximum)
4. 2-4 bullets per field maximum
5. Each field must have UNIQUE content — no repeating information across fields
6. Synthesize in your own words — do NOT copy sentences verbatim from the paper
7. Use the paper's own terminology and specific numbers/statistics when available
8. ADAPT each field's meaning to the paper's type (empirical vs review vs meta-analysis)
9. Return ALL 7 standard fields PLUS paper_type in the JSON — use "Not mentioned" for empty fields`

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

Return valid JSON with: paper_type, background, theory, methodology, measures, results, implications, limitations.
Format each field value as bullet points (•) separated by \\n (literal backslash-n).
Example: "background": "• First point here.\\n• Second key finding."`

    const fields = ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations']

    let fieldDefinitionsText = ''
    for (const fd of EXTRACTION_FIELDS) {
      fieldDefinitionsText += `
${fields.indexOf(fd.key) + 1}. ${fd.label} (max ${fd.maxWords} words, ${fd.maxBullets} bullets)
   [A] ${fd.definitionA}
   [B] ${fd.definitionB}
   [C] ${fd.definitionC}
   Extract from: ${fd.sourceScope}
   Do NOT include: ${fd.antiExample}`
    }

    if (customFields && customFields.length > 0) {
      customFields.forEach(field => {
        fields.push(field.id)
        fieldDefinitionsText += `
${fields.indexOf(field.id) + 1}. ${field.name}
   [ALL] ${field.description}
   Extract from: Entire paper text
   Do NOT include: information already covered in other fields`
      })
    }

    const outputKeys = ['paper_type', ...fields]
    const outputTemplate = JSON.stringify(
      Object.fromEntries(outputKeys.map(f => [f, ''])),
      null,
      2
    )

    const userPrompt = `PAPER TEXT:
${paperText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — CLASSIFY the paper type:
Read the paper text above and determine its type.
[A] Empirical study: has original data collection (participants, experiments, studies with results)
[B] Review / theoretical paper: surveys, synthesizes existing literature without new data collection
[C] Meta-analysis or systematic review: has systematic search criteria and pooled statistical results

Include "paper_type": "A", "B", or "C" in your JSON output.

STEP 2 — EXTRACT content for each field:
For your detected type, use the [A], [B], or [C] definition for each field below.
- Only extract from the specified "Extract from" sections
- Never include the "Do NOT include" content
- Respect the word limit per field
- Write in your own words — synthesize, do NOT copy sentences verbatim
- Format each field as bullet points (•) separated by literal \\n

FIELD DEFINITIONS (adapt to detected paper type):${fieldDefinitionsText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON using these exact keys:
${outputTemplate}

If a field has no applicable content, use exactly: "Not mentioned"
Do NOT wrap in markdown code blocks.
IMPORTANT: paper_type plus all fields must be present.`

    return {
      systemPrompt,
      userPrompt,
      expectedFields: outputKeys
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
    const paperType = existingExtraction.paperType || 'unknown'
    const modeInstructions = detailLevel === 'brief'
      ? this.BRIEF_MODE_INSTRUCTIONS
      : this.DETAILED_MODE_INSTRUCTIONS

    let fieldGuidance = ''
    for (const fd of EXTRACTION_FIELDS) {
      if (!fieldsToUpdate.includes(fd.key)) continue
      const typeDef = paperType === 'B' ? fd.definitionB : paperType === 'C' ? fd.definitionC : fd.definitionA
      fieldGuidance += `
${fd.label} (max ${fd.maxWords} words, ${fd.maxBullets} bullets)
   Definition: ${typeDef}
   Extract from: ${fd.sourceScope}
   Do NOT include: ${fd.antiExample}`
    }

    const systemPrompt = `${this.BASE_SYSTEM_PROMPT}

${modeInstructions}

You are updating an existing extraction. Paper type: ${paperType === 'A' ? 'Empirical study' : paperType === 'B' ? 'Review paper' : paperType === 'C' ? 'Meta-analysis' : 'Unknown'}.

Focus only on these fields: ${fieldsToUpdate.join(', ')}

Current extraction (for reference):
${JSON.stringify(existingExtraction, null, 2)}

Provide improved content ONLY for the specified fields. Keep all other fields as-is.`

    const userPrompt = `Re-analyze the paper text and provide improved extraction for the specified fields:

${paperText}

Field definitions for this paper (adapt per paper type):
${fieldGuidance}

Respond with a complete JSON object containing ALL original fields. Improve only: ${fieldsToUpdate.join(', ')}. All other fields must match the current extraction exactly.`

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
