/**
 * StudyKit v0.5 P6 — where each sentence of a piece of writing came from.
 *
 * Recorded when a sentence (an `OutputStatement`) is first written, and
 * never rewritten afterwards: editing the text keeps the origin, so an
 * AI draft the user later edits still shows as an edited AI draft.
 *
 *   - written:  typed by the user.
 *   - argument: composed from the user's argument (their point and
 *               reasoning, plus the excerpts they cited).
 *   - ai:       began as an AI draft the user accepted. Keeps the AI's
 *               original text, so "used as is" and "edited" can be told
 *               apart at any time.
 *   - imported: brought in from elsewhere.
 *
 * Sentences written before P6 have no origin. Reports say so plainly
 * instead of guessing.
 */

export type StatementOrigin =
  | { readonly kind: 'written' }
  | {
      readonly kind: 'argument';
      readonly claimId: string;
      /** The point itself was first suggested by the AI. */
      readonly pointFromAi?: boolean;
    }
  | {
      readonly kind: 'ai';
      readonly provider: string;
      readonly model?: string;
      readonly draftedAt: string;
      readonly acceptedAt: string;
      /** The AI's text as drafted, before any edit by the user. */
      readonly aiText: string;
    }
  | { readonly kind: 'imported' };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function isStatementOrigin(value: unknown): value is StatementOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'written':
    case 'imported':
      return true;
    case 'argument':
      return str(v.claimId) && (v.pointFromAi === undefined || typeof v.pointFromAi === 'boolean');
    case 'ai':
      return (
        str(v.provider) &&
        (v.model === undefined || typeof v.model === 'string') &&
        str(v.draftedAt) &&
        str(v.acceptedAt) &&
        typeof v.aiText === 'string' &&
        v.aiText.length <= 20_000
      );
    default:
      return false;
  }
}

/** How a sentence is described in the source view and the report. */
export type SentenceSource =
  /** The user's own words. */
  | 'own'
  /** Contains a verbatim quote from a checked excerpt. */
  | 'quoted'
  /** Began as an AI draft; the user changed it. */
  | 'ai-edited'
  /** An AI draft used word for word. */
  | 'ai-verbatim'
  /** Brought in from elsewhere (e.g. the old literature hub); who wrote it isn't recorded. */
  | 'imported'
  /** Written before StudyKit recorded sources. */
  | 'unknown';

export const SENTENCE_SOURCES: readonly SentenceSource[] = ['own', 'quoted', 'ai-edited', 'ai-verbatim', 'imported', 'unknown'];

export const SENTENCE_SOURCE_LABEL: Readonly<Record<SentenceSource, string>> = {
  own: 'Your own words',
  quoted: 'Quotes a source',
  'ai-edited': 'AI draft, edited by you',
  'ai-verbatim': 'AI draft, used as is',
  imported: 'Imported from elsewhere',
  unknown: 'Written before sources were recorded',
};

/** Shortest excerpt fragment that counts as quoting the source. */
export const MIN_QUOTE_CHARS = 20;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
const stripQuotes = (s: string): string => s.replace(/[“”"‘’']/g, '');

/** Does `body` reproduce (part of) `quote` word for word? */
export function quotesExcerpt(body: string, quote: string): boolean {
  const b = stripQuotes(squash(body));
  const q = stripQuotes(squash(quote));
  if (q.length < MIN_QUOTE_CHARS) return false;
  if (b.includes(q)) return true;
  // A long excerpt is often quoted in part: any 40-character stretch of
  // it (starting at a word) found in the sentence counts.
  const words = q.split(' ');
  for (let i = 0; i < words.length; i += 1) {
    const run = words.slice(i).join(' ').slice(0, 40);
    if (run.length < MIN_QUOTE_CHARS) break;
    if (b.includes(run)) return true;
  }
  return false;
}

/** Share of the AI's words the user kept, 0..1 (by word, in order). */
export function keptShare(aiText: string, body: string): number {
  const a = squash(aiText).split(' ').filter(Boolean);
  const b = squash(body).split(' ').filter(Boolean);
  if (a.length === 0) return 0;
  // Longest common subsequence of words; sentences are short.
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!);
      diag = up;
    }
  }
  return prev[b.length]! / a.length;
}

/**
 * Classify a sentence. AI origin comes first (it is what a reader most
 * needs to know), then a verbatim quote, then the user's own words.
 */
export function classifySentence(input: {
  readonly body: string;
  readonly origin: StatementOrigin | undefined;
  /** Exact quotes of the checked excerpts the sentence might quote. */
  readonly quotes: readonly string[];
}): SentenceSource {
  const { body, origin } = input;
  if (origin?.kind === 'ai') return squash(origin.aiText) === squash(body) ? 'ai-verbatim' : 'ai-edited';
  if (input.quotes.some((q) => quotesExcerpt(body, q))) return 'quoted';
  if (!origin) return 'unknown';
  if (origin.kind === 'imported') return 'imported';
  return 'own';
}
