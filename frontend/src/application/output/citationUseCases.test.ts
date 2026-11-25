import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository, type ResearchRepository } from '../research/researchRepository';
import type { Work } from '../../domain/research';
import { addSection, addStatement, attachSupport, createOutput, deleteStatement } from './outputUseCases';
import { auditStatementCitation, insertStatementCitation, removeStatementCitation } from './citationUseCases';
import { exportOutputCslJson, exportOutputMarkdown } from './citationExport';

const now = '2026-07-31T00:00:00.000Z';

describe('citation use cases and export', () => {
  let repo: ResearchRepository;
  let work: Work;
  let outputId: string;
  let sectionId: string;
  let statementId: string;

  beforeEach(async () => {
    repo = new MemoryResearchRepository();
    work = {
      id: 'work-1', identifiers: { doi: '10.1234/example' }, title: 'Sleep and Memory',
      authors: ['Doe, Jane'], year: 2025, venue: 'Journal', metadataProvenance: {}, integrity: 'ok',
      integrityCheckedAt: now, assetIds: [], projectIds: ['p-1'], readingStatus: 'read', importance: 0,
      createdAt: now, updatedAt: now, authorType: 'imported',
    };
    await repo.transact((tx) => {
      tx.putProject({
        id: 'p-1', container: { workspaceId: null, mode: 'research', kind: 'project', id: 'p-1' },
        name: 'P', livingBrief: '', kind: 'blank', createdAt: now, updatedAt: now, authorType: 'user',
      });
      tx.putWork(work);
    });
    const output = await createOutput(repo, { projectId: 'p-1', title: 'Output' }, { clock: () => now, idFactory: () => 'o-1' });
    const section = await addSection(repo, { outputId: output.id, title: 'Intro' }, { clock: () => now, idFactory: () => 's-1' });
    const statement = await addStatement(repo, { sectionId: section.id, body: 'Sleep supports memory.' }, { clock: () => now, idFactory: () => 'st-1' });
    outputId = output.id; sectionId = section.id; statementId = statement.id;
  });

  it('inserts only canonical identified Works and rejects duplicates', async () => {
    const citation = await insertStatementCitation(repo, {
      statementId, workId: work.id, clock: () => now, idFactory: () => 'cite-1',
    });
    expect(citation.citeKey).toContain('doe2025sleep');
    await expect(insertStatementCitation(repo, {
      statementId, workId: work.id, clock: () => now, idFactory: () => 'cite-2',
    })).rejects.toThrow(/duplicate/);
  });

  it('fails closed for unidentifiable, incomplete, or retracted Works', async () => {
    for (const [id, next] of [
      ['no-id', { ...work, id: 'no-id', identifiers: {} }],
      ['no-year', { ...work, id: 'no-year', year: undefined }],
      ['retracted', { ...work, id: 'retracted', integrity: 'retracted' as const }],
    ] as const) {
      await repo.transact((tx) => tx.putWork(next));
      await expect(insertStatementCitation(repo, { statementId, workId: id })).rejects.toThrow();
    }
    expect(await repo.listStatementCitations({ statementId })).toHaveLength(0);
  });

  it('audits entailment independently from citation existence', async () => {
    const citation = await insertStatementCitation(repo, { statementId, workId: work.id, idFactory: () => 'cite-1' });
    expect((await auditStatementCitation(repo, citation.id)).state).toBe('needs-review');
    await repo.transact((tx) => tx.putEvidence({
      id: 'e-1', projectId: 'p-1', workId: work.id,
      locator: { kind: 'paper-work', workId: work.id, capturedAt: now }, exactQuote: 'Sleep helps.',
      userInterpretation: 'Support', evidenceType: 'finding', status: 'verified', createdAt: now, updatedAt: now, authorType: 'user',
    }));
    await attachSupport(repo, { statementId, ref: { kind: 'evidence', id: 'e-1' }, relation: 'supports' });
    expect((await auditStatementCitation(repo, citation.id)).state).toBe('verified');
  });

  it('exports Pandoc citekeys and deterministic CSL-JSON, then removes the link without deleting Work', async () => {
    const citation = await insertStatementCitation(repo, { statementId, workId: work.id, idFactory: () => 'cite-1' });
    const output = (await repo.getOutput(outputId))!;
    const sections = await repo.listOutputSections({ outputId });
    const statements = await repo.listOutputStatements({ outputId });
    const citations = await repo.listStatementCitations({ outputId });
    const markdown = exportOutputMarkdown({ output, sections, statements, citations, works: [work] });
    expect(markdown).toContain(`[@${citation.citeKey}]`);
    expect(exportOutputCslJson({ citations, works: [work] })[0]).toMatchObject({ DOI: '10.1234/example' });
    await removeStatementCitation(repo, citation.id);
    expect(await repo.listStatementCitations({ outputId })).toHaveLength(0);
    expect(await repo.getWork(work.id)).not.toBeNull();
    expect(sectionId).toBe('s-1');
  });

  it('deleting a Statement cascades its citation but preserves the canonical Work', async () => {
    await insertStatementCitation(repo, { statementId, workId: work.id, idFactory: () => 'cite-1' });
    await deleteStatement(repo, { statementId });
    expect(await repo.listStatementCitations({ outputId })).toHaveLength(0);
    expect(await repo.getWork(work.id)).not.toBeNull();
  });
});
