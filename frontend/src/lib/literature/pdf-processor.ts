import * as pdfjsLib from 'pdfjs-dist'

// Worker is already configured by PDFViewer.tsx — no need to set GlobalWorkerOptions here

export interface PDFMetadata {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modificationDate?: Date
}

export interface ExtractedPDFContent {
  metadata: PDFMetadata
  fullText: string
  pages: string[]
  abstract?: string
  extractedReferences: string[]
}

interface PDFTextItem {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

interface TitleExtractionResult {
  title?: string
  endIndex: number
}

export class PDFProcessor {
  private static instance: PDFProcessor

  static getInstance(): PDFProcessor {
    if (!PDFProcessor.instance) {
      PDFProcessor.instance = new PDFProcessor()
    }
    return PDFProcessor.instance
  }

  static async extractPDFContent(file: File): Promise<ExtractedPDFContent> {
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

    const metadata = await this.extractMetadata(pdf)
    const pages = await this.extractAllPages(pdf)
    const fullText = pages.join('\n\n')
    const abstract = this.extractAbstract(fullText)
    const extractedReferences = this.extractReferences(fullText)

    return { metadata, fullText, pages, abstract, extractedReferences }
  }

  private static async extractMetadata(pdf: any): Promise<PDFMetadata> {
    try {
      const info = await pdf.getMetadata()
      return {
        title: info.info?.Title,
        author: info.info?.Author,
        subject: info.info?.Subject,
        keywords: info.info?.Keywords,
        creator: info.info?.Creator,
        producer: info.info?.Producer,
        creationDate: info.info?.CreationDate ? new Date(info.info.CreationDate) : undefined,
        modificationDate: info.info?.ModDate ? new Date(info.info.ModDate) : undefined
      }
    } catch {
      return {}
    }
  }

  private static async extractAllPages(pdf: any): Promise<string[]> {
    const pages: string[] = []
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const pageText = this.textContentToString(textContent.items as PDFTextItem[])
        pages.push(pageText)
      } catch {
        pages.push(`[Page ${pageNum} extraction failed]`)
      }
    }
    return pages
  }

  private static textContentToString(items: PDFTextItem[]): string {
    const positionedItems = items
      .filter((item): item is PDFTextItem & { str: string; transform: number[] } =>
        Boolean(item.str?.trim()) && Array.isArray(item.transform) && item.transform.length >= 6
      )
      .map(item => ({ text: item.str!.trim(), x: item.transform![4], y: item.transform![5] }))

    if (positionedItems.length === 0) {
      return items.filter(item => item.str?.trim()).map(item => item.str!.trim()).join(' ')
    }

    positionedItems.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x)

    const lines: Array<{ y: number; items: typeof positionedItems }> = []
    for (const item of positionedItems) {
      const existingLine = lines.find(line => Math.abs(line.y - item.y) <= 2)
      if (existingLine) existingLine.items.push(item)
      else lines.push({ y: item.y, items: [item] })
    }

    lines.sort((a, b) => b.y - a.y)

    return lines
      .map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
  }

  private static extractAbstract(fullText: string): string | undefined {
    const patterns = [
      /abstract\s*[:\-]?\s*\n?(.*?)(?=\n\s*(?:introduction|keywords|1\.|i\.|background|method))/is,
      /abstract\s*[:\-]?\s*\n?(.*?)(?=\n\s*[A-Z])/is,
    ]
    for (const pattern of patterns) {
      const match = fullText.match(pattern)
      if (match?.[1]) return match[1].trim().replace(/\s+/g, ' ')
    }
    return undefined
  }

  private static extractReferences(fullText: string): string[] {
    const referencePatterns = [
      /references\s*\n?(.*?)(?=\n\s*(?:appendix|tables|figures)|$)/is,
      /bibliography\s*\n?(.*?)(?=\n\s*(?:appendix|tables|figures)|$)/is,
    ]
    let referenceText = ''
    for (const pattern of referencePatterns) {
      const match = fullText.match(pattern)
      if (match?.[1]) { referenceText = match[1]; break }
    }
    if (referenceText) {
      const refMatches = referenceText.match(/\d+\.\s*.*?(?=\n\s*\d+\.|\n\s*[A-Z]|\n\s*$)/gs)
      if (refMatches) return refMatches.map(ref => ref.trim())
    }
    return []
  }

  static extractBibliographicInfo(fullText: string, metadata: PDFMetadata): {
    title?: string; authors?: string; year?: number; journal?: string; doi?: string
  } {
    const result: { title?: string; authors?: string; year?: number; journal?: string; doi?: string } = {}
    const firstPageText = fullText.split(/\n\n+/)[0] || ''
    const frontMatter = fullText.substring(0, 3000)

    if (metadata.title) result.title = metadata.title
    if (metadata.author) {
      const authors = this.extractAuthorNames(metadata.author)
      if (authors.length > 0) result.authors = authors.join('; ')
    }

    if (!result.title) {
      const titleInfo = this.extractTitleFromLines(firstPageText.split('\n').map(l => l.trim()).filter(Boolean))
      if (titleInfo.title) result.title = titleInfo.title
    }

    if (!result.authors) {
      const authorPatterns = [
        /(?:by\s+)?([A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`.-]{1,3})*(?:\s*,\s*[A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`.-]{1,3})*)*(?:\s+and\s+[A-Z][A-Za-z'`-]+(?:\s+[A-Z][A-Za-z'`.-]{1,3})*)?)/,
      ]
      for (const pattern of authorPatterns) {
        const match = frontMatter.match(pattern)
        if (match?.[1]) {
          const authorNames = this.extractAuthorNames(match[1])
          if (authorNames.length > 0) { result.authors = authorNames.join('; '); break }
        }
      }
    }

    const yearMatches = frontMatter.match(/\b(?:19|20)\d{2}\b/g) || []
    const validYears = yearMatches.map(y => parseInt(y, 10)).filter(y => y >= 1950 && y <= new Date().getFullYear() + 1)
    if (validYears.length > 0) result.year = Math.max(...validYears)

    const doiMatch = fullText.match(/doi:\s*(10\.\d+\/[^\s]+)/i)
    if (doiMatch) result.doi = doiMatch[1]

    return result
  }

  private static extractTitleFromLines(lines: string[]): TitleExtractionResult {
    const titleLines: string[] = []
    let endIndex = -1
    for (const [index, line] of lines.slice(0, 8).entries()) {
      const lower = line.toLowerCase()
      if (!line) continue
      if (/(abstract|introduction|keywords)/i.test(lower)) break
      if (line.length < 12) continue
      titleLines.push(line.trim())
      endIndex = index
      if (line.endsWith('?') || line.endsWith(':') || line.length > 80 || titleLines.length >= 3) break
    }
    return { title: titleLines.length > 0 ? titleLines.join(' ').trim() : undefined, endIndex }
  }

  private static extractAuthorNames(value: string): string[] {
    const segments = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
      .replace(/\b(?:university|department|faculty|school|college|research|institute|hospital|journal|received|accepted|published|abstract|doi)\b[\s\S]*$/i, ' ')
      .replace(/\s+/g, ' ').trim()
      .replace(/\d+(?:,\d+)*/g, ' ').replace(/[*†‡§¶]+/g, ' ').trim()
      .replace(/\s*&\s*/g, ', ').replace(/\s+and\s+/gi, ', ')
      .split(',').map(s => s.trim()).filter(Boolean)

    return segments.map(s => this.normalizeAuthorSegment(s)).filter((n): n is string => Boolean(n))
      .filter((n, i, a) => a.indexOf(n) === i)
  }

  private static normalizeAuthorSegment(segment: string): string | undefined {
    const cleaned = segment.replace(/[¨´`^~]+/g, '').replace(/\s*\d+(?:,\d+)*\s*/g, ' ')
      .replace(/[*†‡§¶]+/g, ' ').trim().replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',').replace(/,{2,}/g, ',').replace(/,\s*$/, '')
    if (!cleaned) return undefined

    const parts = cleaned.split(/\s+/).filter(Boolean)
    if (parts.length < 2) return undefined

    const first = parts[0], last = parts.slice(1).join('')
    const name = `${first} ${last}`.trim()
    if (!/^[A-Z][A-Za-z'’.-]{1,}\s[A-Z][A-Za-z'’.-]{1,}$/.test(name)) return undefined
    if (/\b(university|research|department|school|study|journal)\b/i.test(name)) return undefined
    return name
  }

  static validatePDFFile(file: File): { valid: boolean; error?: string } {
    if (file.type !== 'application/pdf')
      return { valid: false, error: 'Invalid file type. Only PDF files are allowed.' }
    if (file.size > 50 * 1024 * 1024)
      return { valid: false, error: 'File size exceeds 50MB limit.' }
    return { valid: true }
  }
}
