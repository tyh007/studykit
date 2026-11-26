import { describe, expect, it } from 'vitest';
import { buildLedger } from './ledger';
import { makeClaim, makeClaimEvidenceLink, makeEvidence, makeResearchLocator } from '../../domain/__fixtures__/domain-fixtures';
import type { ClaimEvidenceRelation, Evidence } from '../../domain/research';

const ev = (id: string, workId: string, status: Evidence['status'] = 'verified', page = 3): Evidence =>
  makeEvidence({ id, workId, status, exactQuote: `quote ${id}`, locator: makeResearchLocator({ workId, pageNumber: page }) });
const link = (id: string, claimId: string, evidenceId: string, relation: ClaimEvidenceRelation = 'supports') =>
  makeClaimEvidenceLink({ id, claimId, evidenceId, relation });

describe('buildLedger', () => {
  it('classifies points by their support', () => {
    const claims = [
      makeClaim({ id: 'c-none', title: 'No support' }),
      makeClaim({ id: 'c-one', title: 'One source' }),
      makeClaim({ id: 'c-two', title: 'Two sources' }),
      makeClaim({ id: 'c-contra', title: 'Contested' }),
    ];
    const evidence = [ev('e1', 'w1'), ev('e2', 'w1'), ev('e3', 'w2'), ev('e4', 'w3'), ev('e5', 'w2')];
    const links = [
      link('l1', 'c-one', 'e1'),
      link('l2', 'c-one', 'e2'),
      link('l3', 'c-two', 'e1'),
      link('l4', 'c-two', 'e3'),
      link('l5', 'c-contra', 'e3'),
      link('l6', 'c-contra', 'e4'),
      link('l7', 'c-contra', 'e5', 'contradicts'),
    ];
    const ledger = buildLedger({ claims, evidence, links });
    const status = Object.fromEntries(ledger.points.map((p) => [p.claim.id, p.status]));
    expect(status).toEqual({ 'c-none': 'no-support', 'c-one': 'single-source', 'c-two': 'supported', 'c-contra': 'contested' });
    expect(ledger.supportedCount).toBe(1);
    const one = ledger.points.find((p) => p.claim.id === 'c-one')!;
    expect(one).toMatchObject({ supports: 2, supportingSources: 1, contradicts: 0 });
  });

  it('lists gaps most urgent first, ending with unconnected excerpts', () => {
    const claims = [makeClaim({ id: 'c-one', title: 'One' }), makeClaim({ id: 'c-none', title: 'None' })];
    const evidence = [ev('e1', 'w1'), ev('e-free', 'w2', 'candidate', 7)];
    const ledger = buildLedger({ claims, evidence, links: [link('l1', 'c-one', 'e1')] });
    expect(ledger.gaps.map((g) => g.kind)).toEqual(['no-support', 'single-source', 'unconnected-excerpt']);
    expect(ledger.gaps[2]).toMatchObject({ evidenceId: 'e-free', workId: 'w2', pageNumber: 7, quote: 'quote e-free' });
  });

  it('ignores rejected excerpts and links to unverified ones', () => {
    const claims = [makeClaim({ id: 'c1', title: 'A' })];
    const evidence = [ev('e-rej', 'w1', 'rejected'), ev('e-cand', 'w1', 'candidate')];
    const links = [link('l1', 'c1', 'e-rej'), link('l2', 'c1', 'e-cand')];
    const ledger = buildLedger({ claims, evidence, links });
    expect(ledger.points[0]?.status).toBe('no-support');
    expect(ledger.excerptCount).toBe(1);
    expect(ledger.gaps.filter((g) => g.kind === 'unconnected-excerpt')).toHaveLength(1);
  });

  it('reports nothing missing when every point has two sources and every excerpt is used', () => {
    const ledger = buildLedger({
      claims: [makeClaim({ id: 'c1', title: 'A' })],
      evidence: [ev('e1', 'w1'), ev('e2', 'w2')],
      links: [link('l1', 'c1', 'e1'), link('l2', 'c1', 'e2', 'qualifies'), link('l3', 'c1', 'e2')],
    });
    expect(ledger.gaps).toEqual([]);
    expect(ledger.points[0]).toMatchObject({ status: 'supported', qualifies: 1 });
  });
});
