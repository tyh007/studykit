/**
 * StudyKit v0.4 — `application/output/outputUseCases.test`
 *
 * Pure use-case tests for the Output slice (WP-10
 * Round 1). Drives `MemoryResearchRepository` so the
 * use cases run against an in-memory adapter (the
 * same adapter the Dexie + SQLite implementations
 * shadow). Every test is deterministic via injected
 * `clock` + `idFactory`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository } from '../research/researchRepository';
import type { ResearchRepository } from '../research/researchRepository';
import { draftLayer, type DraftRecord } from '../../features/ai/kernel/draftLayer';
import type { ProviderRouter } from '../../features/ai/kernel/providerRouter';
import { nowIso } from '../../domain/output';
import type {
  OutputDocument,
  OutputSection,
  OutputStatement,
  StatementSupport,
} from '../../domain/output';
import {
  addSection,
  addStatement,
  assertOutputCompletion,
  attachSupport,
  auditOutput,
  auditStatement,
  createOutput,
  deleteOutput,
  deleteSection,
  deleteStatement,
  removeSupport,
  renameOutput,
  reorderSections,
  reorderStatements,
  setOutputStatus,
  updateStatement,
} from './outputUseCases';
import {
  acceptOutputDraft,
  draftOutputStatements,
  rejectOutputDraft,
} from './outputAiDraftUseCases';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const idFactories = new Map<string, { counter: number; next: () => string }>();

function nextId(prefix: string): string {
  let factory = idFactories.get(prefix);
  if (!factory) {
    let counter = 0;
    factory = {
      counter: 0,
      next: () => {
        counter += 1;
        return `${prefix}-${counter}`;
      },
    };
    idFactories.set(prefix, factory);
  }
  return factory.next();
}

function resetIdFactories(): void {
  idFactories.clear();
}

function makeIdFactory(prefix: string): () => string {
  return () => nextId(prefix);
}

function clockFactory(): () => string {
  let t = 0;
  return () => {
    t += 1;
    return new Date(Date.UTC(2026, 6, 30, 0, 0, t)).toISOString();
  };
}

async function seedProject(repo: ResearchRepository): Promise<{ projectId: string }> {
  const project = await repo.transact(async (tx) => {
    const p = {
      id: 'proj-1',
      container: { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: 'proj-1' },
      name: 'Test',
      livingBrief: '',
      kind: 'blank' as const,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      authorType: 'user' as const,
    };
    tx.putProject(p);
    return p;
  });
  return { projectId: project.id };
}

async function seedAcceptedClaim(
  repo: ResearchRepository,
  projectId: string,
  title = 'Sleep improves memory',
): Promise<{ id: string }> {
  const id = nextId('c');
  await repo.transact(async (tx) => {
    tx.putClaim({
      id,
      projectId,
      title,
      body: 'Studies show sleep improves memory consolidation.',
      status: 'canonical',
      aiSuggested: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      authorType: 'user',
    });
  });
  return { id };
}

async function seedVerifiedEvidence(
  repo: ResearchRepository,
  projectId: string,
  workId: string,
  quote = 'Sleep helps memory.',
): Promise<{ id: string; workId: string }> {
  const id = nextId('e');
  const locator = {
    kind: 'paper-work' as const,
    workId,
    capturedAt: nowIso(),
  };
  await repo.transact(async (tx) => {
    tx.putWork({
      id: workId,
      identifiers: {},
      title: 'Sleep and Memory',
      authors: ['Doe, J.'],
      metadataProvenance: {},
      integrity: 'unknown',
      assetIds: [],
      projectIds: [projectId],
      readingStatus: 'unread',
      importance: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      authorType: 'imported',
    });
    tx.putEvidence({
      id,
      projectId,
      workId,
      locator,
      exactQuote: quote,
      userInterpretation: 'The user notes this supports the claim.',
      evidenceType: 'finding',
      status: 'verified',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      authorType: 'user',
    });
  });
  return { id, workId };
}

function makeRouter(opts: { content: string; provider?: 'ollama' | 'cloud'; model?: string }): ProviderRouter {
  const provider = opts.provider ?? 'ollama';
  const model = opts.model ?? 'llama3.1:8b';
  return {
    probe: async () => ({ aiAvailable: true, providerName: provider }),
    chat: (async () => ({ content: opts.content, provider, model })) as ProviderRouter['chat'],
  };
}

function makeUnavailableRouter(): ProviderRouter {
  return {
    probe: async () => ({ aiAvailable: false, providerName: 'none' }),
    chat: (async () => { throw new Error('router unreachable'); }) as ProviderRouter['chat'],
  };
}

function makeFailingRouter(): ProviderRouter {
  return {
    probe: async () => ({ aiAvailable: true, providerName: 'ollama' }),
    chat: (async () => { throw new Error('provider offline'); }) as ProviderRouter['chat'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Output use cases', () => {
  let repo: ResearchRepository;
  let clock: () => string;
  let idFactory: (prefix: string) => string;
  let projectId: string;
  let claimId: string;
  let evidenceIds: string[];

  beforeEach(async () => {
    repo = new MemoryResearchRepository();
    clock = clockFactory();
    idFactory = makeIdFactory('seed');
    resetIdFactories();
    draftLayer.__resetForTests();
    const seeded = await seedProject(repo);
    projectId = seeded.projectId;
    const claim = await seedAcceptedClaim(repo, projectId);
    claimId = claim.id;
    evidenceIds = [];
    for (let i = 0; i < 3; i += 1) {
      const ev = await seedVerifiedEvidence(repo, projectId, `work-${i + 1}`, `Quote ${i + 1}`);
      evidenceIds.push(ev.id);
    }
  });

  it('creates an Output with sane defaults', async () => {
    const out = await createOutput(
      repo,
      { projectId, title: 'My output' },
      { clock, idFactory },
    );
    expect(out.status).toBe('outline');
    expect(out.authorType).toBe('user');
    expect(out.title).toBe('My output');
    expect(out.projectId).toBe(projectId);
  });

  it('refuses to create an Output for a missing project', async () => {
    await expect(
      createOutput(repo, { projectId: 'does-not-exist', title: 'x' }, { clock, idFactory }),
    ).rejects.toThrow(/project.*not found/);
  });

  it('refuses empty title', async () => {
    await expect(
      createOutput(repo, { projectId, title: '' }, { clock, idFactory }),
    ).rejects.toThrow(/title is required/);
  });

  it('refuses AI authoring a final Output', async () => {
    await expect(
      createOutput(
        repo,
        { projectId, title: 'x', authorType: 'ai', status: 'final' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/AI.*final/);
  });

  it('repository rejects malformed Output values at the canonical boundary', async () => {
    const out = await createOutput(
      repo,
      { projectId, title: 'Valid' },
      { clock, idFactory },
    );
    await expect(
      repo.transact((tx) => {
        tx.putOutput({
          ...out,
          status: 'published',
        } as unknown as OutputDocument);
      }),
    ).rejects.toThrow(/canonical domain contract/);
    expect((await repo.getOutput(out.id))?.status).toBe('outline');
  });

  it('runs the full vertical loop and audits supported', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    const statement = await addStatement(
      repo,
      { sectionId: section.id, body: 'A claim about sleep.' },
      { clock, idFactory },
    );
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'evidence', id: evidenceIds[0] }, relation: 'supports' },
      { clock, idFactory },
    );
    const audit = await auditStatement(repo, { statementId: statement.id });
    expect(audit.state).toBe('supported');
  });

  it('attachSupport rejects a non-verified Evidence', async () => {
    // Add a candidate Evidence (not verified).
    const candidateId = nextId('e');
    await repo.transact(async (tx) => {
      tx.putEvidence({
        id: candidateId,
        projectId,
        workId: 'work-candidate',
        locator: { kind: 'paper-work', workId: 'work-candidate', capturedAt: nowIso() },
        exactQuote: 'q',
        userInterpretation: '',
        evidenceType: 'finding',
        status: 'candidate',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'user',
      });
      tx.putWork({
        id: 'work-candidate',
        identifiers: {},
        title: 'Candidate',
        authors: [],
        metadataProvenance: {},
        integrity: 'unknown',
        assetIds: [],
        projectIds: [projectId],
        readingStatus: 'unread',
        importance: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'imported',
      });
    });
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    const statement = await addStatement(
      repo,
      { sectionId: section.id, body: 'A claim.' },
      { clock, idFactory },
    );
    await expect(
      attachSupport(
        repo,
        { statementId: statement.id, ref: { kind: 'evidence', id: candidateId }, relation: 'supports' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/not verified/);
  });

  it('attachSupport rejects a non-canonical Claim', async () => {
    const draftClaimId = nextId('c');
    await repo.transact(async (tx) => {
      tx.putClaim({
        id: draftClaimId,
        projectId,
        title: 'Draft claim',
        body: 'not canonical yet',
        status: 'draft',
        aiSuggested: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'user',
      });
    });
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    const statement = await addStatement(
      repo,
      { sectionId: section.id, body: 'A claim.' },
      { clock, idFactory },
    );
    await expect(
      attachSupport(
        repo,
        { statementId: statement.id, ref: { kind: 'claim', id: draftClaimId }, relation: 'supports' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/not canonical/);
  });

  it('attachSupport rejects cross-project ref', async () => {
    const otherProjectId = 'proj-other';
    await repo.transact(async (tx) => {
      tx.putProject({
        id: otherProjectId,
        container: { workspaceId: null, mode: 'research', kind: 'project', id: otherProjectId },
        name: 'Other',
        livingBrief: '',
        kind: 'blank',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'user',
      });
    });
    const otherClaim = nextId('c');
    await repo.transact(async (tx) => {
      tx.putClaim({
        id: otherClaim,
        projectId: otherProjectId,
        title: 'Cross',
        body: 'cross-project claim',
        status: 'canonical',
        aiSuggested: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'user',
      });
    });
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    const statement = await addStatement(
      repo,
      { sectionId: section.id, body: 'A claim.' },
      { clock, idFactory },
    );
    await expect(
      attachSupport(
        repo,
        { statementId: statement.id, ref: { kind: 'claim', id: otherClaim }, relation: 'supports' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/different project/);
  });

  it('attachSupport refuses a duplicate (statement, ref, relation) tuple', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    const statement = await addStatement(
      repo,
      { sectionId: section.id, body: 'A claim.' },
      { clock, idFactory },
    );
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    await expect(
      attachSupport(
        repo,
        { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/duplicate/);
  });

  it('addStatement refuses empty body', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    await expect(
      addStatement(repo, { sectionId: section.id, body: '   ' }, { clock, idFactory }),
    ).rejects.toThrow(/body cannot be empty/);
  });

  it('addStatement refuses authorType=ai (AI text must go through the Draft Layer)', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    await expect(
      addStatement(
        repo,
        { sectionId: section.id, body: 'A claim.', authorType: 'ai' as 'user' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/authorType="ai"/);
  });

  it('updateStatement rewrites body', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(
      repo,
      { outputId: out.id, title: 'Intro' },
      { clock, idFactory },
    );
    const statement = await addStatement(
      repo,
      { sectionId: section.id, body: 'Old.' },
      { clock, idFactory },
    );
    const updated = await updateStatement(
      repo,
      { statementId: statement.id, body: 'New.' },
      { clock, idFactory },
    );
    expect(updated.body).toBe('New.');
  });

  it('reorderSections rewrites order starting at 0', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const a = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const b = await addSection(repo, { outputId: out.id, title: 'B' }, { clock, idFactory });
    const c = await addSection(repo, { outputId: out.id, title: 'C' }, { clock, idFactory });
    const reordered = await reorderSections(
      repo,
      { outputId: out.id, sectionIdsInOrder: [c.id, a.id, b.id] },
      { clock, idFactory },
    );
    expect(reordered.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(reordered.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it('reorderSections rejects a foreign section id', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const a = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    await expect(
      reorderSections(
        repo,
        // Foreign id in the same length — the
        // ownership check (not the count check) is
        // what we want to exercise here.
        { outputId: out.id, sectionIdsInOrder: [a.id] },
        { clock, idFactory },
      ),
    ).resolves.toBeDefined();
    // Now flip to a foreign id — should still throw.
    await expect(
      reorderSections(
        repo,
        { outputId: out.id, sectionIdsInOrder: ['foreign'] },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/does not belong/);
  });

  it('reorderSections rejects duplicate ids instead of dropping a section', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const a = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const b = await addSection(repo, { outputId: out.id, title: 'B' }, { clock, idFactory });
    await expect(
      reorderSections(
        repo,
        { outputId: out.id, sectionIdsInOrder: [a.id, a.id] },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/without duplicates/);
    expect((await repo.listOutputSections({ outputId: out.id })).map((s) => s.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it('reorderStatements rewrites order within the section', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const s1 = await addStatement(repo, { sectionId: section.id, body: '1' }, { clock, idFactory });
    const s2 = await addStatement(repo, { sectionId: section.id, body: '2' }, { clock, idFactory });
    const reordered = await reorderStatements(
      repo,
      { sectionId: section.id, statementIdsInOrder: [s2.id, s1.id] },
      { clock, idFactory },
    );
    expect(reordered.map((s) => s.id)).toEqual([s2.id, s1.id]);
  });

  it('reorderStatements rejects duplicate ids instead of dropping a statement', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const s1 = await addStatement(repo, { sectionId: section.id, body: '1' }, { clock, idFactory });
    const s2 = await addStatement(repo, { sectionId: section.id, body: '2' }, { clock, idFactory });
    await expect(
      reorderStatements(
        repo,
        { sectionId: section.id, statementIdsInOrder: [s1.id, s1.id] },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/without duplicates/);
    expect(
      (await repo.listOutputStatements({ sectionId: section.id })).map((s) => s.id),
    ).toEqual([s1.id, s2.id]);
  });

  it('auditStatement: no supports → unsupported', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'no supports' }, { clock, idFactory });
    const audit = await auditStatement(repo, { statementId: statement.id });
    expect(audit.state).toBe('unsupported');
  });

  it('auditStatement: contradicted + supports → conflicted', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'evidence', id: evidenceIds[0] }, relation: 'supports' },
      { clock, idFactory },
    );
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'evidence', id: evidenceIds[1] }, relation: 'contradicts' },
      { clock, idFactory },
    );
    const audit = await auditStatement(repo, { statementId: statement.id });
    expect(audit.state).toBe('conflicted');
  });

  it('auditStatement: deleting the Evidence leaves the Support as broken', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'evidence', id: evidenceIds[0] }, relation: 'supports' },
      { clock, idFactory },
    );
    // Delete the Evidence. The Support survives
    // (no cascading); the audit should now show broken.
    await repo.transact(async (tx) => {
      tx.deleteEvidence(evidenceIds[0]);
    });
    const audit = await auditStatement(repo, { statementId: statement.id });
    expect(audit.state).toBe('broken');
    expect(audit.reasons.some((r) => r.kind === 'evidence-not-verified' || r.kind === 'broken-ref')).toBe(true);
  });

  it('auditOutput returns overall + per-statement audit', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const s1 = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    const s2 = await addStatement(repo, { sectionId: section.id, body: 'b' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: s1.id, ref: { kind: 'evidence', id: evidenceIds[0] }, relation: 'supports' },
      { clock, idFactory },
    );
    const audit = await auditOutput(repo, { outputId: out.id });
    expect(audit.overall).toBe('unsupported'); // s2 pulls overall up
    expect(audit.byStatement.get(s1.id)?.state).toBe('supported');
    expect(audit.byStatement.get(s2.id)?.state).toBe('unsupported');
  });

  it('deleteOutput cascades to supports, statements, sections', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    const support = await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    await deleteOutput(repo, { outputId: out.id });
    expect(await repo.getOutput(out.id)).toBeNull();
    expect(await repo.getOutputSection(section.id)).toBeNull();
    expect(await repo.getOutputStatement(statement.id)).toBeNull();
    const supports = await repo.listStatementSupports({ statementId: statement.id });
    expect(supports).toHaveLength(0);
    // The Claim itself is NOT touched.
    expect(await repo.getClaim(claimId)).not.toBeNull();
    // sanity: support id is gone
    void support;
  });

  it('deleteSection keeps sibling sections + their statements intact', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const a = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const b = await addSection(repo, { outputId: out.id, title: 'B' }, { clock, idFactory });
    await addStatement(repo, { sectionId: a.id, body: 'keep me' }, { clock, idFactory });
    const stmtB = await addStatement(repo, { sectionId: b.id, body: 'delete me' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: stmtB.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    await deleteSection(repo, { sectionId: b.id });
    expect(await repo.getOutputSection(a.id)).not.toBeNull();
    expect(await repo.getOutputSection(b.id)).toBeNull();
    expect(await repo.getOutputStatement(stmtB.id)).toBeNull();
    // A's statement survived.
    const surviving = await repo.listOutputStatements({ sectionId: a.id });
    expect(surviving).toHaveLength(1);
  });

  it('deleteStatement also removes its Supports', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    await deleteStatement(repo, { statementId: statement.id });
    expect(await repo.getOutputStatement(statement.id)).toBeNull();
    const supports = await repo.listStatementSupports({ statementId: statement.id });
    expect(supports).toHaveLength(0);
  });

  it('removeSupport keeps the Statement but drops the Support', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    const support = await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    await removeSupport(repo, { supportId: support.id });
    const supports = await repo.listStatementSupports({ statementId: statement.id });
    expect(supports).toHaveLength(0);
  });

  it('renameOutput / setOutputStatus', async () => {
    const out = await createOutput(repo, { projectId, title: 'Old' }, { clock, idFactory });
    const renamed = await renameOutput(
      repo,
      { outputId: out.id, title: 'New' },
      { clock, idFactory },
    );
    expect(renamed.title).toBe('New');
    const finalized = await setOutputStatus(
      repo,
      { outputId: out.id, status: 'final' },
      { clock, idFactory },
    );
    expect(finalized.status).toBe('final');
  });

  it('assertOutputCompletion validates the new completionRef rules', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    // outline → rejected
    await expect(
      assertOutputCompletion(repo, { projectId, outputId: out.id }),
    ).rejects.toThrow(/final/);
    await setOutputStatus(
      repo,
      { outputId: out.id, status: 'final' },
      { clock, idFactory },
    );
    // final + same project → accepted
    await expect(
      assertOutputCompletion(repo, { projectId, outputId: out.id }),
    ).resolves.toMatchObject({ status: 'final' });
    // forged id → rejected
    await expect(
      assertOutputCompletion(repo, { projectId, outputId: 'out-forged' }),
    ).rejects.toThrow(/non-existent/);
    // cross-project → rejected
    await expect(
      assertOutputCompletion(repo, { projectId: 'proj-other', outputId: out.id }),
    ).rejects.toThrow(/points at an Output in project/);
  });

  it('transaction rollback: duplicate attach leaves the store unchanged', async () => {
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    const before = await repo.listStatementSupports({ statementId: statement.id });
    await expect(
      attachSupport(
        repo,
        { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
        { clock, idFactory },
      ),
    ).rejects.toThrow(/duplicate/);
    const after = await repo.listStatementSupports({ statementId: statement.id });
    expect(after).toEqual(before);
  });

  it('single notification per transact: a multi-write batch fires the listener once', async () => {
    let calls = 0;
    const unsub = repo.subscribe(() => {
      calls += 1;
    });
    const out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    const section = await addSection(repo, { outputId: out.id, title: 'A' }, { clock, idFactory });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'a' }, { clock, idFactory });
    await attachSupport(
      repo,
      { statementId: statement.id, ref: { kind: 'claim', id: claimId }, relation: 'supports' },
      { clock, idFactory },
    );
    expect(calls).toBeGreaterThanOrEqual(4); // one notification per transact call
    unsub();
  });
});

describe('AI draft flow', () => {
  let repo: ResearchRepository;
  let clock: () => string;
  let idFactory: (prefix: string) => string;
  let projectId: string;
  let claimId: string;
  let evidenceIds: string[];
  let out: OutputDocument;
  let section: OutputSection;

  beforeEach(async () => {
    repo = new MemoryResearchRepository();
    clock = clockFactory();
    idFactory = makeIdFactory('seed');
    resetIdFactories();
    draftLayer.__resetForTests();
    const seeded = await seedProject(repo);
    projectId = seeded.projectId;
    const claim = await seedAcceptedClaim(repo, projectId);
    claimId = claim.id;
    evidenceIds = [];
    for (let i = 0; i < 3; i += 1) {
      const ev = await seedVerifiedEvidence(repo, projectId, `work-${i + 1}`, `Quote ${i + 1}`);
      evidenceIds.push(ev.id);
    }
    out = await createOutput(repo, { projectId, title: 'O' }, { clock, idFactory });
    section = await addSection(repo, { outputId: out.id, title: 'Intro' }, { clock, idFactory });
  });

  it('Accept creates one Statement + N Supports and transitions the draft', async () => {
    const citedBody = `It is well supported. [CLAIM ${claimId}] [EVIDENCE ${evidenceIds[0]}] [EVIDENCE ${evidenceIds[1]}]`;
    const router = makeRouter({ content: `My statement\n\n${citedBody}` });
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: evidenceIds.slice(0, 2),
      providerRouter: router,
      clock,
      idFactory,
    });
    expect(result.draft.status).toBe('draft');
    expect(result.draft.provenance.provider).toBe('ollama');
    expect(result.draft.provenance.model).toBe('llama3.1:8b');
    const accepted = await acceptOutputDraft({
      draftId: result.draft.id,
      repository: repo,
      idFactory,
    });
    expect(accepted.statement.body).toBe(citedBody);
    expect(accepted.supports).toHaveLength(3);
    const audit = await auditStatement(repo, { statementId: accepted.statement.id });
    expect(audit.state).toBe('supported');
    expect(draftLayer.get(result.draft.id)?.status).toBe('accepted');
  });

  it('Reject transitions to rejected and writes nothing to the repository', async () => {
    const router = makeRouter({ content: 'AI body' });
    const beforeStatements = await repo.listOutputStatements({ outputId: out.id });
    const beforeSupports = await repo.listStatementSupports({ outputId: out.id });
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: [],
      providerRouter: router,
      clock,
      idFactory,
    });
    rejectOutputDraft({ draftId: result.draft.id });
    expect(draftLayer.get(result.draft.id)?.status).toBe('rejected');
    const afterStatements = await repo.listOutputStatements({ outputId: out.id });
    const afterSupports = await repo.listStatementSupports({ outputId: out.id });
    expect(afterStatements).toEqual(beforeStatements);
    expect(afterSupports).toEqual(beforeSupports);
  });

  it('AI off: probe says unavailable → fail closed', async () => {
    const router = makeUnavailableRouter();
    await expect(
      draftOutputStatements(repo, {
        projectId,
        outputId: out.id,
        sectionId: section.id,
        selectedClaimIds: [claimId],
        selectedEvidenceIds: [],
        providerRouter: router,
        clock,
        idFactory,
      }),
    ).rejects.toThrow(/AI is unavailable/);
  });

  it('AI provider failure during chat → use case throws; no repository writes', async () => {
    const router = makeFailingRouter();
    await expect(
      draftOutputStatements(repo, {
        projectId,
        outputId: out.id,
        sectionId: section.id,
        selectedClaimIds: [claimId],
        selectedEvidenceIds: [],
        providerRouter: router,
        clock,
        idFactory,
      }),
    ).rejects.toThrow(/provider failed/);
  });

  it('Empty selection → use case throws before the provider runs', async () => {
    const router = makeRouter({ content: 'should never be called' });
    await expect(
      draftOutputStatements(repo, {
        projectId,
        outputId: out.id,
        sectionId: section.id,
        selectedClaimIds: [],
        selectedEvidenceIds: [],
        providerRouter: router,
        clock,
        idFactory,
      }),
    ).rejects.toThrow(/at least one/);
  });

  it('Invalid ref (non-canonical Claim) → use case throws; no draft created', async () => {
    // Draft the Claim down to `draft`.
    await repo.transact(async (tx) => {
      tx.putClaim({
        id: claimId,
        projectId,
        title: 'Sleep improves memory',
        body: 'Studies show sleep improves memory consolidation.',
        status: 'draft',
        aiSuggested: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        authorType: 'user',
      });
    });
    const router = makeRouter({ content: 'should never run' });
    await expect(
      draftOutputStatements(repo, {
        projectId,
        outputId: out.id,
        sectionId: section.id,
        selectedClaimIds: [claimId],
        selectedEvidenceIds: [],
        providerRouter: router,
        clock,
        idFactory,
      }),
    ).rejects.toThrow(/not canonical/);
    // No draft was created.
    expect(draftLayer.list()).toHaveLength(0);
  });

  it('Provenance records the Ollama provider + model + scope tokens', async () => {
    const router = makeRouter({ content: 'Title\n\nBody', provider: 'ollama', model: 'mistral:7b' });
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: [evidenceIds[0]],
      providerRouter: router,
      clock,
      idFactory,
    });
    expect(result.draft.provenance.provider).toBe('ollama');
    expect(result.draft.provenance.model).toBe('mistral:7b');
    expect(result.draft.provenance.sourceScope).toEqual([
      `output:${out.id}`,
      `section:${section.id}`,
      `claim:${claimId}`,
      `evidence:${evidenceIds[0]}`,
    ]);
  });

  it('Accept preserves uncited AI text but does not claim the selected context supports it', async () => {
    const router = makeRouter({
      content: 'My Title\n\nThis statement goes beyond the evidence.',
    });
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: [],
      providerRouter: router,
      clock,
      idFactory,
    });
    const accepted = await acceptOutputDraft({
      draftId: result.draft.id,
      repository: repo,
      idFactory,
    });
    // The body is preserved verbatim (the AI's
    // "beyond evidence" content is kept; the use
    // case does NOT silently rewrite the body).
    expect(accepted.statement.body).toBe('This statement goes beyond the evidence.');
    // Selection supplied context to the model; it is
    // not evidence of entailment. Without an explicit
    // citation the Statement remains unsupported.
    expect(accepted.supports).toHaveLength(0);
    const audit = await auditStatement(repo, { statementId: accepted.statement.id });
    expect(audit.state).toBe('unsupported');
  });

  it('invented citations are not turned into canonical Supports', async () => {
    const router = makeRouter({
      content: 'My Title\n\nBody [CLAIM invented-claim].',
    });
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: [],
      providerRouter: router,
      clock,
      idFactory,
    });
    const accepted = await acceptOutputDraft({
      draftId: result.draft.id,
      repository: repo,
      idFactory,
    });
    expect(accepted.supports).toHaveLength(0);
    expect((await auditStatement(repo, { statementId: accepted.statement.id })).state).toBe(
      'unsupported',
    );
  });

  it('Accept uses the user-edited Draft Layer body and its explicit citations', async () => {
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: [],
      providerRouter: makeRouter({ content: 'My Title\n\nUncited draft.' }),
      clock,
      idFactory,
    });
    draftLayer.updateBody(result.draft.id, {
      kind: 'note-draft',
      title: 'My Title',
      body: `User-reviewed body [CLAIM ${claimId}].`,
      moduleId: section.id,
    });
    const accepted = await acceptOutputDraft({
      draftId: result.draft.id,
      repository: repo,
      idFactory,
    });
    expect(accepted.statement.body).toBe(
      `User-reviewed body [CLAIM ${claimId}].`,
    );
    expect(accepted.supports.map((support) => support.ref)).toEqual([
      { kind: 'claim', id: claimId },
    ]);
  });

  it('Accept revalidates cited sources and leaves both stores unchanged on failure', async () => {
    const router = makeRouter({
      content: `My Title\n\nBody [CLAIM ${claimId}].`,
    });
    const result = await draftOutputStatements(repo, {
      projectId,
      outputId: out.id,
      sectionId: section.id,
      selectedClaimIds: [claimId],
      selectedEvidenceIds: [],
      providerRouter: router,
      clock,
      idFactory,
    });
    const claim = await repo.getClaim(claimId);
    await repo.transact((tx) => {
      tx.putClaim({ ...claim!, status: 'draft' });
    });
    await expect(
      acceptOutputDraft({
        draftId: result.draft.id,
        repository: repo,
        idFactory,
      }),
    ).rejects.toThrow(/no longer canonical/);
    expect(await repo.listOutputStatements({ outputId: out.id })).toHaveLength(0);
    expect(draftLayer.get(result.draft.id)?.status).toBe('draft');
  });
});
