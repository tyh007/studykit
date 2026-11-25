import type { Evidence, Work } from './research';
import type { OutputStatement, StatementSupport } from './output';

/** A citation is a link to a canonical Work, never free-form bibliography text. */
export interface StatementCitation {
  readonly id: string;
  readonly projectId: string;
  readonly outputId: string;
  readonly statementId: string;
  readonly workId: string;
  readonly citeKey: string;
  readonly authorType: 'user' | 'imported';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isStatementCitation(value: unknown): value is StatementCitation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    typeof v.projectId === 'string' && v.projectId.length > 0 &&
    typeof v.outputId === 'string' && v.outputId.length > 0 &&
    typeof v.statementId === 'string' && v.statementId.length > 0 &&
    typeof v.workId === 'string' && v.workId.length > 0 &&
    typeof v.citeKey === 'string' && /^[a-z0-9][a-z0-9._:-]*$/i.test(v.citeKey) &&
    (v.authorType === 'user' || v.authorType === 'imported') &&
    typeof v.createdAt === 'string' && !Number.isNaN(Date.parse(v.createdAt)) &&
    typeof v.updatedAt === 'string' && !Number.isNaN(Date.parse(v.updatedAt))
  );
}

export function citationDedupKey(
  citation: Pick<StatementCitation, 'statementId' | 'workId'>,
): string {
  return `${citation.statementId}::${citation.workId}`;
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Stable key; the Work id suffix prevents same-author/year/title collisions. */
export function citeKeyForWork(work: Work): string {
  const family = slug(work.authors[0]?.split(',')[0] ?? 'anon') || 'anon';
  const year = work.year && Number.isInteger(work.year) ? String(work.year) : 'nd';
  const titleWord = slug(work.title).split('-').find(Boolean) ?? 'work';
  const suffix = slug(work.id).slice(-8) || 'item';
  return `${family}${year}${titleWord}-${suffix}`;
}

export type CitationAuditLevel = 'pass' | 'warning' | 'fail';
export type CitationAuditLayer = 'identity' | 'metadata' | 'integrity' | 'entailment';

export interface CitationAuditCheck {
  readonly layer: CitationAuditLayer;
  readonly level: CitationAuditLevel;
  readonly message: string;
}

export interface CitationAudit {
  readonly citationId: string;
  readonly state: 'verified' | 'needs-review' | 'blocked';
  readonly checks: readonly CitationAuditCheck[];
}

function hasIdentifier(work: Work): boolean {
  return Object.values(work.identifiers).some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

export function auditCitation(input: {
  readonly citation: StatementCitation;
  readonly statement: OutputStatement | null;
  readonly work: Work | null;
  readonly evidence: readonly Evidence[];
  readonly supports: readonly StatementSupport[];
}): CitationAudit {
  const checks: CitationAuditCheck[] = [];
  const { citation, statement, work } = input;
  if (!work || !statement || work.id !== citation.workId) {
    checks.push({ layer: 'identity', level: 'fail', message: 'Canonical Work or Statement is missing.' });
  } else if (
    statement.projectId !== citation.projectId ||
    statement.outputId !== citation.outputId ||
    !work.projectIds.includes(citation.projectId)
  ) {
    checks.push({ layer: 'identity', level: 'fail', message: 'Citation crosses its canonical project boundary.' });
  } else if (!hasIdentifier(work)) {
    checks.push({ layer: 'identity', level: 'warning', message: 'Work has no verified external identifier.' });
  } else {
    checks.push({ layer: 'identity', level: 'pass', message: 'Citation resolves to a canonical identified Work.' });
  }

  if (!work || !work.title.trim() || work.authors.length === 0 || !work.year) {
    checks.push({ layer: 'metadata', level: 'fail', message: 'Title, author, or publication year is missing.' });
  } else {
    checks.push({ layer: 'metadata', level: 'pass', message: 'Core citation metadata is complete.' });
  }

  if (!work || work.integrity === 'retracted') {
    checks.push({ layer: 'integrity', level: 'fail', message: 'Work is missing or retracted.' });
  } else if (work.integrity === 'ok') {
    checks.push({ layer: 'integrity', level: 'pass', message: 'Integrity status is checked and OK.' });
  } else {
    checks.push({
      layer: 'integrity',
      level: 'warning',
      message: `Integrity status requires review (${work.integrity}).`,
    });
  }

  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const related = input.supports.filter(
    (support) =>
      support.statementId === citation.statementId &&
      support.ref.kind === 'evidence' &&
      evidenceById.get(support.ref.id)?.workId === citation.workId,
  );
  if (related.some((support) => support.relation === 'contradicts')) {
    checks.push({ layer: 'entailment', level: 'fail', message: 'Linked evidence from this Work contradicts the Statement.' });
  } else if (related.some((support) => support.relation === 'supports' || support.relation === 'qualifies')) {
    checks.push({ layer: 'entailment', level: 'pass', message: 'The Statement links supporting Evidence from this Work.' });
  } else {
    checks.push({ layer: 'entailment', level: 'warning', message: 'Citation exists, but no supporting Evidence from this Work is linked.' });
  }

  const state = checks.some((check) => check.level === 'fail')
    ? 'blocked'
    : checks.some((check) => check.level === 'warning')
      ? 'needs-review'
      : 'verified';
  return { citationId: citation.id, state, checks };
}

export interface CslJsonItem {
  readonly id: string;
  readonly type: 'article';
  readonly title: string;
  readonly author: readonly { readonly family: string; readonly given?: string }[];
  readonly issued?: { readonly 'date-parts': readonly [readonly [number]] };
  readonly 'container-title'?: string;
  readonly DOI?: string;
}

export function workToCslJson(work: Work, citeKey = citeKeyForWork(work)): CslJsonItem {
  const author = work.authors.map((name) => {
    const [family = name, given] = name.split(',').map((part) => part.trim());
    return given ? { family, given } : { family };
  });
  return {
    id: citeKey,
    // Work does not yet carry a bibliographic item type.
    // Use CSL's generic `article` instead of inventing a
    // journal classification from venue text.
    type: 'article',
    title: work.title,
    author,
    ...(work.year ? { issued: { 'date-parts': [[work.year]] } } : {}),
    ...(work.venue ? { 'container-title': work.venue } : {}),
    ...(work.identifiers.doi ? { DOI: work.identifiers.doi } : {}),
  };
}
