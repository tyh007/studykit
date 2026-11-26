/**
 * StudyKit v0.5 P2 — the verification ledger.
 *
 * Pure: turns a project's points (Claims), excerpts (Evidence) and the
 * links between them into the state of each point and a short list of
 * what is still missing. The workbench shows this as "What's missing".
 *
 * Only links to verified excerpts count (the use cases already refuse
 * to link anything else); rejected excerpts are ignored.
 */

import type { Claim, ClaimEvidenceLink, Evidence } from '../../domain/research';

export type PointStatus =
  /** No excerpt supports it yet. */
  | 'no-support'
  /** At least one excerpt contradicts it. */
  | 'contested'
  /** Supported, but every supporting excerpt comes from one source. */
  | 'single-source'
  /** Supported by two or more sources and not contradicted. */
  | 'supported';

export interface PointLedgerEntry {
  readonly claim: Claim;
  readonly supports: number;
  readonly contradicts: number;
  readonly qualifies: number;
  /** Distinct sources among the supporting excerpts. */
  readonly supportingSources: number;
  readonly status: PointStatus;
}

export type LedgerGap =
  | { readonly kind: 'no-support'; readonly claimId: string; readonly title: string }
  | { readonly kind: 'contested'; readonly claimId: string; readonly title: string; readonly contradicts: number }
  | { readonly kind: 'single-source'; readonly claimId: string; readonly title: string }
  | {
      readonly kind: 'unconnected-excerpt';
      readonly evidenceId: string;
      readonly workId: string;
      readonly pageNumber: number | null;
      readonly quote: string;
    };

export interface Ledger {
  readonly points: readonly PointLedgerEntry[];
  readonly excerptCount: number;
  readonly supportedCount: number;
  readonly gaps: readonly LedgerGap[];
}

export interface LedgerInput {
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly links: readonly ClaimEvidenceLink[];
}

const GAP_ORDER: Readonly<Record<LedgerGap['kind'], number>> = {
  'no-support': 0,
  contested: 1,
  'single-source': 2,
  'unconnected-excerpt': 3,
};

function pageOf(e: Evidence): number | null {
  const n = (e.locator as { pageNumber?: unknown }).pageNumber;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function buildLedger(input: LedgerInput): Ledger {
  const live = input.evidence.filter((e) => e.status !== 'rejected');
  const verifiedById = new Map(live.filter((e) => e.status === 'verified').map((e) => [e.id, e]));
  const linked = new Set<string>();
  const byClaim = new Map<string, ClaimEvidenceLink[]>();
  for (const l of input.links) {
    const ev = verifiedById.get(l.evidenceId);
    if (!ev) continue;
    linked.add(ev.id);
    const list = byClaim.get(l.claimId) ?? [];
    list.push(l);
    byClaim.set(l.claimId, list);
  }

  const points: PointLedgerEntry[] = input.claims.map((claim) => {
    const links = byClaim.get(claim.id) ?? [];
    const supporting = links.filter((l) => l.relation === 'supports');
    const supports = supporting.length;
    const contradicts = links.filter((l) => l.relation === 'contradicts').length;
    const qualifies = links.filter((l) => l.relation === 'qualifies').length;
    const supportingSources = new Set(supporting.map((l) => verifiedById.get(l.evidenceId)?.workId)).size;
    const status: PointStatus =
      supports === 0 ? 'no-support' : contradicts > 0 ? 'contested' : supportingSources < 2 ? 'single-source' : 'supported';
    return { claim, supports, contradicts, qualifies, supportingSources, status };
  });

  const gaps: LedgerGap[] = [];
  for (const p of points) {
    if (p.status === 'no-support') gaps.push({ kind: 'no-support', claimId: p.claim.id, title: p.claim.title });
    else if (p.status === 'contested')
      gaps.push({ kind: 'contested', claimId: p.claim.id, title: p.claim.title, contradicts: p.contradicts });
    else if (p.status === 'single-source') gaps.push({ kind: 'single-source', claimId: p.claim.id, title: p.claim.title });
  }
  for (const e of live) {
    if (linked.has(e.id)) continue;
    gaps.push({
      kind: 'unconnected-excerpt',
      evidenceId: e.id,
      workId: e.workId,
      pageNumber: pageOf(e),
      quote: e.exactQuote,
    });
  }
  gaps.sort((a, b) => GAP_ORDER[a.kind] - GAP_ORDER[b.kind]);

  return {
    points,
    excerptCount: live.length,
    supportedCount: points.filter((p) => p.status === 'supported').length,
    gaps,
  };
}
