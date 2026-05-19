import type { ExtractedData, CustomFieldDefinition } from './types'
import { OllamaClient } from './ollama-client'
import { readOllamaSettings, type OllamaSettings } from './ollama-settings'
import { PromptBuilder } from './prompt-builder'

type SectionField = keyof Omit<ExtractedData, 'customFields'>

const SECTION_FIELD_CONFIG: Array<{ key: SectionField; headings: string[]; keywords: string[] }> = [
  {
    key: 'background',
    headings: ['abstract', 'introduction', 'background', 'related work', 'literature review', 'literature'],
    keywords: ['background', 'introduction', 'motivation', 'problem', 'context', 'related work', 'literature', 'prior work']
  },
  {
    key: 'theory',
    headings: ['theory', 'theoretical framework', 'conceptual framework', 'hypotheses', 'literature review', 'conceptual background', 'theoretical background', 'framework'],
    keywords: ['theory', 'framework', 'hypothesis', 'mechanism', 'conceptual', 'theoretical', 'model', 'proposition']
  },
  {
    key: 'methodology',
    headings: ['method', 'methods', 'methodology', 'participants', 'procedure', 'study design', 'research design', 'experimental design', 'approach'],
    keywords: ['method', 'methods', 'methodology', 'participants', 'procedure', 'design', 'experiment', 'study', 'approach', 'participants']
  },
  {
    key: 'measures',
    headings: ['measures', 'materials', 'instruments', 'materials and methods', 'data collection', 'measurement', 'apparatus', 'tools'],
    keywords: ['measure', 'measures', 'instrument', 'scale', 'questionnaire', 'survey', 'assessment', 'operationali', 'apparatus', 'tool']
  },
  {
    key: 'results',
    headings: ['results', 'findings', 'analysis', 'findings and results', 'outcomes'],
    keywords: ['result', 'results', 'findings', 'analysis', 'significant', 'effect', 'accuracy', 'outcome', 'correlation']
  },
  {
    key: 'implications',
    headings: ['discussion', 'conclusion', 'implications', 'conclusions', 'discussion and implications'],
    keywords: ['discussion', 'conclusion', 'implication', 'implications', 'contribution', 'practical', 'theoretical contribution', 'significance']
  },
  {
    key: 'limitations',
    headings: ['limitations', 'future work', 'future research', 'limitation'],
    keywords: ['limitation', 'limitations', 'future work', 'future research', 'constraint', 'constraint', 'generalizability', 'limitation']
  }
]

function getClient(settings: OllamaSettings = readOllamaSettings()) {
  return new OllamaClient(settings.baseUrl, settings.model)
}

export function truncatePaperText(text: string, maxLength: number = 16000) {
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength)
  const lastParagraph = truncated.lastIndexOf('\n\n')
  return lastParagraph > maxLength * 0.85 ? truncated.slice(0, lastParagraph) : truncated
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'Not mentioned'
}

function ensureFormattedString(value: string): string {
  if (value === 'Not mentioned' || !value) return 'Not mentioned'

  let normalized = value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/^[-–•]\s*/gm, '• ')
    .replace(/\n\n+/g, '\n')
    .trim()

  if (normalized.includes('•')) {
    const lines = normalized.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    if (lines.length > 1) {
      return lines.map(line => {
        const cleaned = line.replace(/^[-–•]\s*/, '')
        return cleaned.startsWith('•') ? line : `• ${cleaned}`
      }).join('\n')
    }
    return normalized
  }

  return formatAsBulletPoints(value, 3)
}

export function parseExtractionResponse(parsed: Record<string, unknown>): ExtractedData {
  const reserved = new Set([
    'background', 'theory', 'methodology', 'measures',
    'results', 'implications', 'limitations'
  ])

  const customEntries = Object.entries(parsed)
    .filter(([key, value]) => !reserved.has(key) && typeof value === 'string')
    .map(([key, value]) => [key, ensureFormattedString(String(value).trim())])
    .filter(([, value]) => value !== 'Not mentioned')

  return {
    background: ensureFormattedString(readString(parsed.background)),
    theory: ensureFormattedString(readString(parsed.theory)),
    methodology: ensureFormattedString(readString(parsed.methodology)),
    measures: ensureFormattedString(readString(parsed.measures)),
    results: ensureFormattedString(readString(parsed.results)),
    implications: ensureFormattedString(readString(parsed.implications)),
    limitations: ensureFormattedString(readString(parsed.limitations)),
    customFields: customEntries.length > 0 ? Object.fromEntries(customEntries) : undefined
  }
}

const TEMPLATE_PHRASES = [
  'research context, problem statement',
  'theoretical framework and specific hypotheses',
  'research design, sample characteristics',
  'all scales, instruments, and measurement tools',
  'main findings, statistical results',
  'theoretical and practical contributions',
  'study limitations acknowledged by authors',
]

function looksLikeTemplateOutput(text: string): boolean {
  if (text === 'Not mentioned' || !text) return false
  const lower = text.toLowerCase().trim()
  // Exact match of a template phrase = definitely template output
  if (TEMPLATE_PHRASES.some(phrase => lower === phrase.toLowerCase())) return true
  // Short text that matches ANY template phrase = probable template output
  if (text.length < 100 && TEMPLATE_PHRASES.some(phrase => lower.includes(phrase))) return true
  return false
}

export function validateExtractedData(extracted: ExtractedData) {
  const values = [
    extracted.background, extracted.theory, extracted.methodology,
    extracted.measures, extracted.results, extracted.implications, extracted.limitations
  ]
  const meaningfulCount = values.filter(value =>
    value && value !== 'Not mentioned' && !looksLikeTemplateOutput(value)
  ).length
  const uniqueCount = new Set(
    values.filter(value => value && value !== 'Not mentioned').map(value => value.toLowerCase())
  ).size
  const hasMinimalContent = meaningfulCount >= 1
  const hasMultipleFields = uniqueCount >= 2
  return hasMinimalContent || hasMultipleFields
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

// Split academic text into sentences, handling periods in abbreviations,
// statistical notation (p < .001), decimals (3.14), initials (J. Smith),
// and other non-sentence-boundary periods common in academic papers.
function splitSentences(text: string): string[] {
  const result: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    // Only consider . ! ? as sentence terminators
    if (ch !== '.' && ch !== '!' && ch !== '?') continue
    // Ensure there's whitespace after the punctuation
    const nextChar = text[i + 1]
    if (nextChar === undefined || !/\s/.test(nextChar)) continue

    // Check patterns that should NOT end a sentence:
    const beforePeriod = text.slice(start, i)
    const lastWord = beforePeriod.split(/\s+/).pop() || ''
    const afterSpace = text.slice(i + 1).replace(/^\s+/, '')

    // Not a sentence end if followed by lowercase (continuation)
    if (/^[a-z]/.test(afterSpace)) continue

    // Not a sentence end if the word before is a known abbreviation
    if (ABBREVIATION_WORDS.has(lastWord.toLowerCase().replace(/[^a-z.]/g, ''))) continue

    // Not a sentence end if it's a decimal number (digit before . and after)
    const beforeCh = text[i - 1]
    if (beforeCh && /\d/.test(beforeCh)) {
      // Check if it's a number like 3.14 (digit.digit)
      const afterDecimal = text.slice(i + 1).match(/^(\d+)\s/)
      if (afterDecimal) continue
    }

    // Not a sentence end if it's a single-capital-letter initial (J. Smith)
    if (/^[A-Z]$/.test(lastWord.trim())) continue

    // Not "et al." — count as sentence end
    // It IS a sentence boundary — split here
    const sentenceEnd = afterSpace ? i + 1 + (text.slice(i + 1).length - afterSpace.length) : i + 1
    const sentence = text.slice(start, sentenceEnd).trim()
    if (sentence) result.push(sentence)
    start = sentenceEnd
  }

  const remaining = text.slice(start).trim()
  if (remaining) result.push(remaining)
  if (result.length === 0) result.push(text.trim())
  return result
}

const ABBREVIATION_WORDS = new Set([
  'e.g', 'i.e', 'et al', 'vs', 'fig', 'eq', 'vol', 'no', 'pp', 'cf', 'etc',
  'al', 'dept', 'est', 'approx', 'min', 'max', 'hr', 'sec', 'temp',
  'diff', 'coeff', 'var', 'std', 'dev', 'ref', 'chap', 'eds',
  'trans', 'diss', 'abstr', 'rev', 'col', 'dept', 'univ',
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'ave', 'blvd',
])

function cleanAndNormalizeText(text: string): string {
  return text
    .replace(/[A-Z][A-Z\s–\-]{30,}(?=\n|$)/g, '')
    .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
    .replace(/\bKEYWORDS\b.*?(?=\n\n|\n[A-Z]|$)/is, '')
    .replace(/\bABSTRACT\b\s*[:\-]?\s*/i, '')
    .replace(/^.*?@.*?$\n/gm, '')
    .replace(/^.*?(?:University|Department|School|College|Institute|Laboratory).*?$\n/gm, '')
    .replace(/(\w+)-(?=\n)/g, '$1')
    .replace(/([a-z])\n+([a-z])/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim()
}

function stripTrailingNoise(text: string) {
  return text
    .replace(/\breferences\b[\s\S]*$/i, ' ')
    .replace(/\bappendix\b[\s\S]*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanContentLine(line: string) {
  return normalizeWhitespace(line)
    .replace(/^\d+\s+/, '')
    .replace(/^[-•]\s+/, '')
}

function isNoiseLine(line: string) {
  const lower = line.toLowerCase()
  return (
    !line ||
    /@/.test(line) ||
    /^(figure|table)\s+\d+/i.test(line) ||
    /\b(?:copyright|permission to make|acm|proceedings)\b/.test(lower) ||
    /\b(?:university|department|school|college|laboratory|institute)\b/.test(lower)
  )
}

function isLikelyHeading(line: string) {
  const lower = line.toLowerCase().replace(/[.:]/g, '').trim()
  if (!lower) return false
  if (lower.length > 60) return false
  return SECTION_FIELD_CONFIG.some(config => config.headings.includes(lower))
}

function splitIntoCleanLines(text: string) {
  return text.split('\n').map(cleanContentLine).filter(line => line.length > 0)
}

function collectSectionBlocks(text: string) {
  const trimmed = stripTrailingNoise(text)
  const lines = splitIntoCleanLines(trimmed)
  const sections = new Map<string, string[]>()
  let currentHeading: string | null = null

  for (const rawLine of lines) {
    if (isNoiseLine(rawLine)) continue
    const line = cleanContentLine(rawLine)
    if (!line) continue
    const lower = line.toLowerCase().replace(/[.:]/g, '').trim()

    if (isLikelyHeading(line)) {
      currentHeading = lower
      if (!sections.has(currentHeading)) {
        sections.set(currentHeading, [])
      }
      continue
    }

    if (currentHeading) {
      const bucket = sections.get(currentHeading)
      if (bucket && bucket.join(' ').length < 8000) {
        bucket.push(line)
      }
    }
  }

  return sections
}

function takeSentences(text: string, count: number, maxChars: number) {
  const sentences = splitSentences(text)
    .map(sentence => normalizeWhitespace(sentence))
    .filter(sentence => sentence.length > 10 && !isNoiseLine(sentence))

  if (sentences.length === 0) {
    return normalizeWhitespace(text).slice(0, maxChars)
  }

  let result = ''
  for (let i = 0; i < Math.min(count, sentences.length); i++) {
    const sentence = sentences[i]
    if ((result + sentence).length <= maxChars) {
      result += (result ? ' ' : '') + sentence
    } else if (result) {
      break
    } else {
      result = sentence.slice(0, maxChars)
      break
    }
  }

  return result || normalizeWhitespace(text).slice(0, maxChars)
}

function getSentences(text: string) {
  return splitSentences(text)
    .map(sentence => normalizeWhitespace(sentence))
    .filter(sentence => sentence.length > 20)
    .filter(sentence => !isNoiseLine(sentence))
    .filter(sentence => !/^(copyright|permission to make|references)\b/i.test(sentence))
}

function scoreSentence(sentence: string, keywords: string[]) {
  const lower = sentence.toLowerCase()
  let score = 0
  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += 1
  }
  if (/\bwe (propose|conduct|test|examine|investigate|evaluate|show|find)\b/.test(lower)) score += 0.5
  if (/\bparticipants?\b|\bsample\b|\bexperiment\b|\bstudy\b/.test(lower)) score += 0.5
  if (/\bresults?\b|\bfindings?\b|\bsignificant\b|\bimproved?\b/.test(lower)) score += 0.5
  return score
}

function pickSentencesByKeywords(text: string, keywords: string[], count: number, maxChars: number) {
  const sentences = getSentences(text)
    .map(sentence => ({ sentence, score: scoreSentence(sentence, keywords) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)

  if (sentences.length === 0) return undefined

  const picked: string[] = []
  const seenNormalized = new Set<string>()

  for (const item of sentences) {
    const normalized = item.sentence.toLowerCase()
    if (!seenNormalized.has(normalized) && !picked.includes(item.sentence)) {
      seenNormalized.add(normalized)
      picked.push(item.sentence)
    }
    if (picked.length >= count) break
  }

  const result = picked.join(' ').slice(0, maxChars)
  return result.length > 0 ? result : undefined
}

function seemsLikeLimitation(text: string) {
  const lower = text.toLowerCase()
  return /\b(limitation|limitations|future work|future research|constraint|caution|generalizability)\b/.test(lower)
}

function dedupeField(value: string, usedValues: Set<string>) {
  const normalized = value.toLowerCase()
  if (usedValues.has(normalized)) return 'Not mentioned'
  usedValues.add(normalized)
  return value
}

function findKeywordParagraph(text: string, keywords: string[]) {
  const paragraphs = text
    .split(/\n\n+/)
    .map(paragraph => normalizeWhitespace(paragraph))
    .filter(paragraph => paragraph.length > 80)
    .filter(paragraph => !looksLikeFrontMatter(paragraph))
    .filter(paragraph => !/^references\b/i.test(paragraph))

  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase()
    if (keywords.some(keyword => lower.includes(keyword)) && isUsableSectionParagraph(paragraph)) {
      return paragraph
    }
  }

  return undefined
}

export function buildFocusedPaperContext(text: string, context?: { title?: string; abstract?: string }) {
  const sections = collectSectionBlocks(text)
  const parts: string[] = []

  if (context?.title) {
    parts.push(`Title: ${normalizeWhitespace(context.title)}`)
  }

  if (context?.abstract) {
    parts.push(`Abstract: ${takeSentences(context.abstract, 6, 1000)}`)
  } else {
    const extractedAbstract = extractAbstractBlock(text)
    if (extractedAbstract) {
      parts.push(`Abstract: ${takeSentences(extractedAbstract, 6, 1000)}`)
    }
  }

  for (const config of SECTION_FIELD_CONFIG) {
    let candidate = ''
    for (const heading of config.headings) {
      const block = sections.get(heading)
      if (block && block.length > 0) {
        candidate = block.join(' ')
        break
      }
    }
    if (!candidate) {
      candidate = findKeywordParagraph(text, config.keywords) || ''
    }
    if (!candidate) {
      candidate = pickSentencesByKeywords(text, config.keywords, 12, 2500) || ''
    }
    if (candidate) {
      parts.push(`${config.key.toUpperCase()}: ${takeSentences(candidate, 12, 2500)}`)
    }
  }

  if (parts.length === 0) {
    parts.push(stripTrailingNoise(text).slice(0, 12000))
  }

  return parts.join('\n\n').slice(0, 16000)
}

function tryLooseFieldExtraction(raw: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}
  for (const config of SECTION_FIELD_CONFIG) {
    const pattern = new RegExp(`"${config.key}"\\s*:\\s*"([\\s\\S]*?)"(?:\\s*,\\s*"|\\s*\\})`, 'i')
    const match = raw.match(pattern)
    if (match?.[1]) {
      result[config.key] = match[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/  +/g, ' ')
        .trim()
    }
  }
  return Object.keys(result).length >= 4 ? result : null
}

function extractAbstractBlock(text: string) {
  const match = text.match(/abstract\s*[:\-]?\s*\n?(.*?)(?=\n\s*(?:keywords|introduction|1\.|i\.|background|method))/is)
  if (!match?.[1]) return undefined
  const cleaned = match[1].replace(/\s+/g, ' ').trim()
  return cleaned.length >= 120 ? cleaned.slice(0, 420) : undefined
}

function looksLikeFrontMatter(paragraph: string) {
  const lower = paragraph.toLowerCase()
  return (
    /@/.test(paragraph) ||
    /(university|department|school|college|received|accepted|published|copyright|permission to make)/.test(lower) ||
    /^[A-Z][A-Za-z .,&:-]{0,120}$/.test(paragraph)
  )
}

function isUsableSectionParagraph(paragraph: string) {
  const lower = paragraph.toLowerCase()
  if (/@/.test(paragraph)) return false
  if (/(university|department|school|college)/.test(lower)) return false
  if (paragraph.split(/\s+/).length < 18) return false
  return true
}

function formatAsBulletPoints(text: string, maxBullets: number = 3): string {
  if (!text || text === 'Not mentioned') return 'Not mentioned'

  const lines = text.split('\n').filter(line => line.trim().length > 0)

  if (lines.length > 1) {
    const seen = new Set<string>()
    const unique: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      const cleaned = trimmed.replace(/^[-–•]\s*/, '')
      const normalized = cleaned.toLowerCase()
      if (!seen.has(normalized) && cleaned.length > 0) {
        seen.add(normalized)
        unique.push(`• ${cleaned}`)
      }
    }

    if (unique.length > 0) {
      return unique.slice(0, maxBullets).join('\n')
    }
  }

  const sentences = splitSentences(text)
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 20) return false
      if (/^(fig|table|ref|page|www|http|copyright|permission to make|keywords|see|caption)/i.test(s)) return false
      if (s.endsWith('...') || s.endsWith('–') || s.endsWith('-')) return false
      if (/\w+-\s*$/.test(s)) return false
      return true
    })

  if (sentences.length === 0) return `• ${text}`

  const qualitySentences = sentences.filter(s => {
    const words = s.split(/\s+/)
    if (words.length < 3) return false
    if (/^(and they|however,|further|additionally)\s+/i.test(s)) return false
    return true
  })

  if (qualitySentences.length === 0) return `• ${text}`

  const seenSentences = new Set<string>()
  const uniqueSentences: string[] = []

  for (const sentence of qualitySentences) {
    const normalized = sentence.toLowerCase()
    if (!seenSentences.has(normalized)) {
      seenSentences.add(normalized)
      uniqueSentences.push(sentence)
    }
  }

  if (uniqueSentences.length === 0) return `• ${text}`

  return uniqueSentences.slice(0, maxBullets).map(s => `• ${s}`).join('\n')
}

export function extractPaperWithRules(text: string): ExtractedData {
  const cleanedText = cleanAndNormalizeText(text)
  const sections = collectSectionBlocks(cleanedText)
  const abstract = extractAbstractBlock(cleanedText)
  const referenceSafeText = stripTrailingNoise(cleanedText)
  const output = {} as Record<SectionField, string>

  for (const config of SECTION_FIELD_CONFIG) {
    const usedValues = new Set<string>()
    let candidate = ''

    for (const heading of config.headings) {
      const block = sections.get(heading)
      if (block && block.length > 0) {
        candidate = block.join(' ')
        break
      }
    }

    if (!candidate && config.key === 'background' && abstract) {
      candidate = abstract
    }

    if (!candidate) {
      candidate = findKeywordParagraph(referenceSafeText, config.keywords) || ''
    }

    if (!candidate) {
      candidate = pickSentencesByKeywords(referenceSafeText, config.keywords, 3, 500) || ''
    }

    let finalValue = candidate ? takeSentences(candidate, 3, 500) : 'Not mentioned'

    if (config.key === 'limitations' && finalValue !== 'Not mentioned' && !seemsLikeLimitation(finalValue)) {
      finalValue = 'Not mentioned'
    }

    if (config.key === 'implications' && finalValue !== 'Not mentioned') {
      const lower = finalValue.toLowerCase()
      if (!/\b(implication|implications|suggest|contribution|practical|application|useful|improve)\b/.test(lower)) {
        finalValue = 'Not mentioned'
      }
    }

    output[config.key] = finalValue === 'Not mentioned'
      ? finalValue
      : formatAsBulletPoints(dedupeField(finalValue, usedValues), 3)
  }

  return output
}

async function chatForJson(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<{ parsed: Record<string, unknown>; model: string }> {
  const settings = readOllamaSettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })

  const response = await client.chat({
    model: resolvedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false,
    format: 'json',
    options: {
      temperature: 0.5,
      max_tokens: 4096
    }
  })

  const cleaned = PromptBuilder.sanitizeResponse(response.message.content)
  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch (error) {
    const loose = tryLooseFieldExtraction(cleaned)
    if (loose) {
      parsed = loose
      return { parsed, model: response.model || resolvedModel }
    }

    const preview = response.message.content.slice(0, 300)
    throw new Error(
      `Ollama returned non-JSON output. Preview: ${preview}${preview.length >= 300 ? '...' : ''}`
    )
  }

  return { parsed, model: response.model || resolvedModel }
}

export async function getLocalOllamaAvailability() {
  const settings = readOllamaSettings()
  const client = getClient(settings)
  const models = await client.getAvailableModels()

  return {
    available: models.length > 0,
    models: models.map(model => model.name),
    currentBaseUrl: settings.baseUrl
  }
}

export async function extractPaperWithLocalOllama(
  paperText: string,
  detailLevel: 'brief' | 'detailed' = 'brief',
  customFields?: CustomFieldDefinition[],
  model?: string,
  context?: { title?: string; abstract?: string }
) {
  try {
    const prompt = PromptBuilder.buildExtractionPrompt(
      buildFocusedPaperContext(truncatePaperText(paperText), context),
      detailLevel,
      customFields
    )
    const result = await chatForJson(prompt.systemPrompt, prompt.userPrompt, model)
    const extractedData = parseExtractionResponse(result.parsed)

    if (!validateExtractedData(extractedData)) {
      console.warn('Ollama extraction validation failed. Attempting rule-based fallback...')
      const ruleBasedData = extractPaperWithRules(paperText)
      return {
        extractedData: ruleBasedData,
        model: `${result.model} (with rule-based fallback)`
      }
    }

    return { extractedData, model: result.model }
  } catch (error) {
    console.warn('Ollama extraction error, using rule-based fallback:', error instanceof Error ? error.message : String(error))
    const fallbackData = extractPaperWithRules(paperText)
    return {
      extractedData: fallbackData,
      model: 'rule-based extraction (error fallback)'
    }
  }
}

export async function extractCustomFieldWithLocalOllama(
  paperText: string,
  customField: CustomFieldDefinition,
  detailLevel: 'brief' | 'detailed' = 'brief',
  model?: string
) {
  const settings = readOllamaSettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })
  const prompt = PromptBuilder.buildCustomFieldPrompt(
    truncatePaperText(paperText),
    customField,
    detailLevel
  )
  return client.generateText(prompt, resolvedModel, {
    temperature: 0.1,
    max_tokens: detailLevel === 'detailed' ? 700 : 300
  })
}

export async function reExtractFieldsWithLocalOllama(
  paperText: string,
  existingExtraction: ExtractedData,
  fieldsToUpdate: string[],
  detailLevel: 'brief' | 'detailed' = 'brief',
  model?: string
) {
  const prompt = PromptBuilder.buildReExtractionPrompt(
    truncatePaperText(paperText),
    existingExtraction,
    fieldsToUpdate,
    detailLevel
  )
  const result = await chatForJson(prompt.systemPrompt, prompt.userPrompt, model)
  return {
    extractedData: parseExtractionResponse(result.parsed),
    model: result.model
  }
}

export async function performCrossPaperAnalysisWithLocalOllama(
  papers: Array<{
    title: string
    authors: string
    year: number
    extractedData: ExtractedData
  }>,
  analysisQuestion: string,
  model?: string
) {
  const settings = readOllamaSettings()
  const resolvedModel = model || settings.model
  const client = getClient({ ...settings, model: resolvedModel })
  const prompt = PromptBuilder.buildCrossPaperAnalysisPrompt(papers, analysisQuestion)
  return client.generateText(prompt, resolvedModel, {
    temperature: 0.2,
    max_tokens: 900
  })
}
