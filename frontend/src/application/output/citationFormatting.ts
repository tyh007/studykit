import type { CslJsonItem } from '../../domain/citation';

export type CitationStyle = 'apa' | 'mla' | 'chicago-author-date';

export interface FormattedCitations {
  readonly style: CitationStyle;
  readonly citations: Readonly<Record<string, string>>;
  readonly bibliography: string;
}

interface StyleInfo {
  readonly content: string;
}

let modulesPromise: Promise<{
  Cite: new (data?: unknown) => { format(kind: string, options?: Record<string, unknown>): string };
}> | null = null;

function unwrapStyle(value: StyleInfo | { readonly default: StyleInfo }): StyleInfo {
  return 'content' in value ? value : value.default;
}

async function loadCitationModules(): Promise<{
  Cite: new (data?: unknown) => { format(kind: string, options?: Record<string, unknown>): string };
}> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('@citation-js/core'),
      import('@citation-js/plugin-csl'),
      import('@citation-js/plugin-bibtex'),
      import('@citation-js/plugin-ris'),
      import('@citation/csl-style-modern-language-association'),
      import('@citation/csl-style-chicago-author-date'),
    ]).then(([core, _csl, _bibtex, _ris, mlaModule, chicagoModule]) => {
      const config = core.plugins.config.get('@csl');
      const styles = config.styles ?? config.templates;
      if (!styles) throw new Error('Citation processor did not expose a CSL style registry.');
      styles.add('studykit-mla', unwrapStyle(mlaModule.default).content);
      styles.add('studykit-chicago-author-date', unwrapStyle(chicagoModule.default).content);
      return { Cite: core.Cite };
    });
  }
  return modulesPromise;
}

function processorStyle(style: CitationStyle): string {
  if (style === 'mla') return 'studykit-mla';
  if (style === 'chicago-author-date') return 'studykit-chicago-author-date';
  return 'apa';
}

export async function formatCitationsWithCsl(
  items: readonly CslJsonItem[],
  style: CitationStyle,
): Promise<FormattedCitations> {
  const { Cite } = await loadCitationModules();
  const selectedStyle = processorStyle(style);
  const bibliography = new Cite(items).format('bibliography', {
    format: 'text',
    style: selectedStyle,
    lang: 'en-US',
  }).trim();
  const citations: Record<string, string> = {};
  for (const item of items) {
    citations[item.id] = new Cite([item]).format('citation', {
      format: 'text',
      style: selectedStyle,
      lang: 'en-US',
    }).trim();
  }
  return { style, citations, bibliography };
}

export async function exportCitationsBibtex(items: readonly CslJsonItem[]): Promise<string> {
  const { Cite } = await loadCitationModules();
  // Citation.js derives a fresh BibTeX label by default.
  // Replace only the entry header so StudyKit's stable
  // canonical citekey survives the exchange format.
  return items.map((item) =>
    new Cite([item]).format('bibtex').trimEnd().replace(
      /^(@[a-z]+\{)[^,]+/i,
      `$1${item.id}`,
    ),
  ).join('\n\n');
}

export async function exportCitationsRis(items: readonly CslJsonItem[]): Promise<string> {
  const { Cite } = await loadCitationModules();
  return new Cite(items).format('ris').trimEnd();
}
