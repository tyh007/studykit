import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import {
  addPoint,
  buildArgument,
  citeInSlot,
  composeArgumentDraft,
  movePoint,
  orderPoints,
  removeCite,
  updatePoint,
} from './argument';
import {
  makeClaim,
  makeClaimEvidenceLink,
  makeEvidence,
  makeResearchLocator,
  makeResearchProject,
  makeWork,
} from '../../domain/__fixtures__/domain-fixtures';
import type { Evidence } from '../../domain/research';

const P = 'p-001';
const ev = (id: string, workId: string, status: Evidence['status'] = 'verified', page = 3, note = ''): Evidence =>
  makeEvidence({
    id,
    projectId: P,
    workId,
    status,
    exactQuote: `quote ${id}`,
    userInterpretation: note,
    locator: makeResearchLocator({ workId, pageNumber: page }),
  });

let repo: MemoryResearchRepository;

beforeEach(async () => {
  repo = new MemoryResearchRepository();
  await repo.transact(async (tx) => {
    tx.putProject(makeResearchProject({ id: P }));
    tx.putWork(makeWork({ id: 'w-1', title: 'Walker 2004', projectIds: [P] }));
    tx.putWork(makeWork({ id: 'w-2', title: 'Stickgold 2005', projectIds: [P] }));
    tx.putEvidence(ev('e-1', 'w-1', 'verified', 4, 'Recall improved after a night of sleep'));
    tx.putEvidence(ev('e-2', 'w-2', 'verified', 9, 'No effect on procedural skills'));
    tx.putEvidence(ev('e-3', 'w-2', 'verified', 11, 'Only tested in young adults'));
    tx.putEvidence(ev('e-cand', 'w-1', 'candidate'));
  });
});

describe('buildArgument', () => {
  it('lists empty slots as gaps and treats “none found” as considered', () => {
    const claims = [
      makeClaim({ id: 'c-1', projectId: P, title: 'A', body: '' }),
      makeClaim({ id: 'c-2', projectId: P, title: 'B', body: 'Because', argument: { noCounter: true, noLimits: true } }),
    ];
    const links = [makeClaimEvidenceLink({ id: 'l-1', projectId: P, claimId: 'c-2', evidenceId: 'e-1' })];
    const view = buildArgument({ claims, evidence: [ev('e-1', 'w-1')], links, works: [{ id: 'w-1', title: 'Walker 2004' }] });
    expect(view.points.map((p) => p.gaps)).toEqual([['evidence', 'reasoning', 'counter', 'limits'], []]);
    expect(view.points[1]!.evidence[0]).toMatchObject({ workTitle: 'Walker 2004', pageNumber: 3, quote: 'quote e-1' });
    expect(view.completeCount).toBe(1);
    expect(view.ready).toBe(false);
  });

  it('never counts unverified excerpts', () => {
    const claims = [makeClaim({ id: 'c-1', projectId: P, body: 'x', argument: { noCounter: true, noLimits: true } })];
    const links = [makeClaimEvidenceLink({ claimId: 'c-1', evidenceId: 'e-cand' })];
    const view = buildArgument({ claims, evidence: [ev('e-cand', 'w-1', 'candidate')], links });
    expect(view.points[0]!.gaps).toEqual(['evidence']);
  });

  it('orders by explicit order, then creation time', () => {
    const ordered = orderPoints([
      makeClaim({ id: 'late', createdAt: '2026-01-03T00:00:00.000Z' }),
      makeClaim({ id: 'second', argument: { order: 1 } }),
      makeClaim({ id: 'first', argument: { order: 0 } }),
      makeClaim({ id: 'early', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['first', 'second', 'early', 'late']);
  });
});

describe('argument use cases', () => {
  it('adds points in order and moves them', async () => {
    const a = await addPoint(repo, { projectId: P, title: ' Sleep helps memory ' });
    const b = await addPoint(repo, { projectId: P, title: 'Naps help too' });
    expect(a.title).toBe('Sleep helps memory');
    await movePoint(repo, { projectId: P, claimId: b.id, offset: -1 });
    expect(orderPoints(await repo.listClaims({ projectId: P })).map((c) => c.id)).toEqual([b.id, a.id]);
    // Moving past the top is a no-op.
    await movePoint(repo, { projectId: P, claimId: b.id, offset: -1 });
    expect(orderPoints(await repo.listClaims({ projectId: P })).map((c) => c.id)).toEqual([b.id, a.id]);
    await expect(addPoint(repo, { projectId: P, title: '  ' })).rejects.toThrow(/needs a title/);
  });

  it('cites verified excerpts into slots, once, and refuses unchecked ones', async () => {
    const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    const l1 = await citeInSlot(repo, { projectId: P, claimId: point.id, evidenceId: 'e-2', slot: 'counter' });
    const again = await citeInSlot(repo, { projectId: P, claimId: point.id, evidenceId: 'e-2', slot: 'counter' });
    expect(again.id).toBe(l1.id);
    expect(l1.relation).toBe('contradicts');
    await expect(
      citeInSlot(repo, { projectId: P, claimId: point.id, evidenceId: 'e-cand', slot: 'evidence' }),
    ).rejects.toThrow(/only checked excerpts/);
    await removeCite(repo, l1.id);
    expect(await repo.listLinks({ projectId: P })).toHaveLength(0);
  });

  it('refuses to write up an argument with gaps', async () => {
    await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    await expect(composeArgumentDraft(repo, { projectId: P })).rejects.toThrow(/fill the empty slots/);
    expect(await repo.listOutputs({ projectId: P })).toHaveLength(0);
  });

  it('writes a complete argument up with every citation attached to its excerpt', async () => {
    const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    await citeInSlot(repo, { projectId: P, claimId: point.id, evidenceId: 'e-1', slot: 'evidence' });
    await citeInSlot(repo, { projectId: P, claimId: point.id, evidenceId: 'e-2', slot: 'counter' });
    await citeInSlot(repo, { projectId: P, claimId: point.id, evidenceId: 'e-3', slot: 'limits' });
    await updatePoint(repo, { claimId: point.id, reasoning: 'Recall is better after sleep than after the same time awake' });
    const second = await addPoint(repo, { projectId: P, title: 'Naps help too.' });
    await citeInSlot(repo, { projectId: P, claimId: second.id, evidenceId: 'e-1', slot: 'evidence' });
    await updatePoint(repo, { claimId: second.id, reasoning: 'Short sleep shows the same pattern.', noCounter: true, noLimits: true });

    const result = await composeArgumentDraft(repo, { projectId: P });
    expect(result).toMatchObject({ sectionCount: 2, citationCount: 4 });
    expect(result.output).toMatchObject({ title: 'Draft from your argument', status: 'draft', authorType: 'user' });

    const sections = await repo.listOutputSections({ outputId: result.output.id });
    expect(sections.map((s) => s.title)).toEqual(['Sleep helps memory', 'Naps help too.']);
    const statements = await repo.listOutputStatements({ outputId: result.output.id });
    const first = statements.filter((s) => s.sectionId === sections[0]!.id).sort((a, b) => a.order - b.order);
    expect(first.map((s) => s.body)).toEqual([
      'Sleep helps memory. Recall is better after sleep than after the same time awake.',
      'However, not every source agrees: No effect on procedural skills.',
      'This holds within limits: Only tested in young adults.',
    ]);
    const supports = await repo.listStatementSupports({ outputId: result.output.id });
    expect(supports.map((s) => [s.ref.id, s.relation]).sort()).toEqual([
      ['e-1', 'supports'],
      ['e-1', 'supports'],
      ['e-2', 'contradicts'],
      ['e-3', 'qualifies'],
    ]);

    // A second write-up does not overwrite the first.
    const again = await composeArgumentDraft(repo, { projectId: P });
    expect(again.output.title).toBe('Draft from your argument 2');
  });
});
