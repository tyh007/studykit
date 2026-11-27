/**
 * v0.5 P7a — mapping tests for the old literature hub (ADR-004). These
 * are the gate before any legacy code is deleted: every kind of legacy
 * data is either mapped as the ADR says or reported as left out.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { importLegacyProject, legacyIds, listLegacyProjects, type LegacyLiteratureSource } from './importLegacyLiterature';
import { buildLedger } from './ledger';
import { loadProvenanceReport } from './provenanceReport';
import type { LiteraturePaper, LiteratureProject } from '../../types';
import { makeWork } from '../../domain/__fixtures__/domain-fixtures';

const T = '2025-03-01T10:00:00.000Z';
const project: LiteratureProject = { id: 'L1', workspace_id: 'ws', name: 'Sleep review', description: 'What does sleep do for memory?', created_at: T, updated_at: T };

function paper(over: Partial<LiteraturePaper>): LiteraturePaper {
  return {
    id: 'P1',
    project_id: 'L1',
    workspace_id: 'ws',
    file_name: 'walker.pdf',
    file_size: 1,
    file_type: 'application/pdf',
    uploaded_at: T,
    processing_status: 'completed',
    in_trash: false,
    created_at: T,
    updated_at: T,
    ...over,
  };
}

const papers: LiteraturePaper[] = [
  paper({
    id: 'P1',
    title: 'Sleep-dependent learning',
    authors: 'Walker, M.; Stickgold, R.',
    year: 2004,
    journal: 'Neuron',
    doi: 'https://doi.org/10.1016/J.NEURON.2004.09.012',
    abstract: 'Sleep helps.',
    reading_status: 'read',
    importance: 4,
    extracted_data: {
      background: 'Memory consolidation.',
      theory: '',
      methodology: 'Lab study',
      measures: '',
      results: 'Recall +20%',
      implications: '',
      limitations: 'Students only',
      customFields: { 'cf-1': 'Young adults' },
    },
  }),
  paper({ id: 'P2', title: '', file_name: 'naps-2010.pdf', authors: 'Mednick, S.' }),
  paper({ id: 'P3', title: 'Old draft', in_trash: true }),
];

function fullSource(over: Partial<LegacyLiteratureSource> = {}): LegacyLiteratureSource {
  return {
    listProjects: async () => [project, { ...project, id: 'L2', name: 'Gone', deleted_at: T } as LiteratureProject],
    listPapers: async () => papers,
    listNotes: async (paperId) => (paperId === 'P1' ? [{ id: 'N1', paper_id: 'P1', content: 'Key paper for chapter 2.' }, { id: 'N2', paper_id: 'P1', content: '  ' }] : []),
    listAnnotations: async (paperId) =>
      paperId === 'P1'
        ? [
            { id: 'A1', paper_id: 'P1', page_number: 11, annotation_type: 'highlight', text_content: 'Recall improved after sleep.' },
            { id: 'A2', paper_id: 'P1', page_number: 12, annotation_type: 'highlight', text_content: null },
            { id: 'A3', paper_id: 'P1', page_number: 12, annotation_type: 'ink' },
            { id: 'A4', paper_id: 'P1', page_number: 13, annotation_type: 'underline', text_content: 'Gone', deleted_at: T },
          ]
        : [],
    listRelations: async (paperId) => [
      // Listed from both papers: imported once.
      { id: 'R1', source_paper_id: 'P2', target_paper_id: 'P1', relation_type: 'extends', description: 'naps instead of nights' },
      ...(paperId === 'P1' ? [{ id: 'R2', source_paper_id: 'P1', target_paper_id: 'OTHER', relation_type: 'cites' }] : []),
    ],
    listCustomFields: async () => [{ id: 'cf-1', project_id: 'L1', workspace_id: 'ws', name: 'Sample', created_at: T }],
    ...over,
  };
}

let repo: MemoryResearchRepository;
beforeEach(() => {
  repo = new MemoryResearchRepository();
});

describe('legacy literature mapping (ADR-004)', () => {
  it('lists legacy projects, minus deleted ones, and knows which were brought in', async () => {
    expect(await listLegacyProjects(repo, fullSource())).toEqual([{ legacyId: 'L1', name: 'Sleep review', projectId: null }]);
    await importLegacyProject(repo, fullSource(), { legacyProjectId: 'L1', userId: 'u-1', now: T });
    expect(await listLegacyProjects(repo, fullSource())).toEqual([{ legacyId: 'L1', name: 'Sleep review', projectId: 'lp_L1' }]);
  });

  it('maps every kind of legacy data as the ADR says', async () => {
    const report = await importLegacyProject(repo, fullSource(), { legacyProjectId: 'L1', userId: 'u-1', now: T });
    expect(report).toEqual({
      projectId: 'lp_L1',
      works: { added: 2, alreadyThere: 0 },
      excerpts: 1,
      notes: 1,
      relations: 1,
      aiSummaries: 1,
      skipped: { trashedPapers: 1, highlightsWithoutText: 1, drawings: 1 },
      unavailable: [],
    });

    // Project
    expect(await repo.getProject('lp_L1')).toMatchObject({ name: 'Sleep review', livingBrief: 'What does sleep do for memory?', kind: 'review', authorType: 'imported' });

    // Papers → Works with a linked file that opens the old PDF
    const works = await repo.listWorks({ projectId: 'lp_L1' });
    const walker = works.find((w) => w.title === 'Sleep-dependent learning')!;
    expect(walker).toMatchObject({
      authors: ['Walker, M.', 'Stickgold, R.'],
      year: 2004,
      venue: 'Neuron',
      identifiers: { doi: '10.1016/j.neuron.2004.09.012' },
      abstract: 'Sleep helps.',
      readingStatus: 'read',
      importance: 4,
      authorType: 'imported',
    });
    expect(await repo.listWorkAssetsForWork(walker.id)).toEqual([expect.objectContaining({ id: 'lit_P1', kind: 'linked-file', ref: 'P1' })]);
    expect(works.find((w) => w.title === 'naps-2010')).toBeDefined(); // file name when there was no title

    // Highlights → unchecked excerpts at the right page; they back nothing yet
    const [excerpt] = await repo.listEvidence({ projectId: 'lp_L1' });
    expect(excerpt).toMatchObject({
      id: 'lit_ann_A1',
      status: 'candidate',
      exactQuote: 'Recall improved after sleep.',
      userInterpretation: '',
      authorType: 'imported',
      locator: { kind: 'paper-page', assetId: 'lit_P1', pageNumber: 11 },
    });
    const ledger = buildLedger({ claims: [], evidence: await repo.listEvidence({ projectId: 'lp_L1' }), links: [] });
    expect(ledger.supportedCount).toBe(0);

    // Notes and relations → writing marked as imported
    const statements = await repo.listOutputStatements({ outputId: legacyIds.notesOutput('L1') });
    expect(statements.map((s) => s.body).sort()).toEqual(['Key paper for chapter 2.', 'naps-2010 extends Sleep-dependent learning: naps instead of nights'].sort());
    expect(statements.every((s) => s.origin?.kind === 'imported' && s.authorType === 'imported')).toBe(true);
    const sections = await repo.listOutputSections({ outputId: legacyIds.notesOutput('L1') });
    expect(sections.map((s) => s.title).sort()).toEqual(['How the papers relate', 'Sleep-dependent learning']);

    // AI summaries → AI text in a private conversation, custom columns by name
    const [thread] = await repo.listAiThreads({ projectId: 'lp_L1' });
    expect(thread).toMatchObject({ title: 'AI summaries from the old literature hub', visibility: 'private' });
    const [summary] = await repo.listAiMessages({ threadId: thread!.id });
    expect(summary).toMatchObject({ role: 'assistant', provider: { id: 'legacy-hub' }, drafts: [] });
    expect(summary!.body).toContain('Method: Lab study');
    expect(summary!.body).toContain('Sample: Young adults');
    expect(summary!.body).toContain('not checked');
    expect(summary!.body).not.toContain('Theory:');

    // The provenance report counts them as imported, not as the author's own words
    const report2 = await loadProvenanceReport(repo, legacyIds.notesOutput('L1'));
    expect(report2.bySource).toMatchObject({ imported: 2, own: 0 });
    expect(report2.aiStatement).toMatch(/^StudyKit did not see how this text was written\. 2 paragraphs were imported from elsewhere/);
  });

  it('can run again: adds only what is new and never overwrites what the user changed', async () => {
    await importLegacyProject(repo, fullSource(), { legacyProjectId: 'L1', userId: 'u-1', now: T });
    const [statement] = await repo.listOutputStatements({ outputId: legacyIds.notesOutput('L1') });
    await repo.transact(async (tx) => tx.putOutputStatement({ ...statement!, body: 'Edited by me.' }));
    const again = await importLegacyProject(repo, fullSource(), { legacyProjectId: 'L1', userId: 'u-1', now: T });
    expect(again).toMatchObject({ works: { added: 0, alreadyThere: 2 }, excerpts: 0, notes: 0, relations: 0, aiSummaries: 0 });
    expect((await repo.listOutputStatements({ outputId: legacyIds.notesOutput('L1') })).map((s) => s.body)).toContain('Edited by me.');
    expect(await repo.listEvidence({ projectId: 'lp_L1' })).toHaveLength(1);
  });

  it('reuses a Work the user already has (same DOI) without touching its fields', async () => {
    const mine = makeWork({ id: 'w-mine', title: 'My title', identifiers: { doi: '10.1016/j.neuron.2004.09.012' }, projectIds: ['p-other'], readingStatus: 'unread' });
    const { makeWorkIdFromIdentifiers } = await import('../../domain/research');
    const id = makeWorkIdFromIdentifiers({ doi: '10.1016/j.neuron.2004.09.012' }, 'Sleep-dependent learning', ['Walker, M.', 'Stickgold, R.'], 2004);
    await repo.transact(async (tx) => tx.putWork({ ...mine, id }));
    const report = await importLegacyProject(repo, fullSource(), { legacyProjectId: 'L1', userId: 'u-1', now: T });
    expect(report.works).toEqual({ added: 1, alreadyThere: 1 });
    expect(await repo.getWork(id)).toMatchObject({ title: 'My title', readingStatus: 'unread', projectIds: ['p-other', 'lp_L1'] });
  });

  it('in a local workspace brings papers and says what it could not reach', async () => {
    const local: LegacyLiteratureSource = { listProjects: fullSource().listProjects, listPapers: fullSource().listPapers };
    const report = await importLegacyProject(repo, local, { legacyProjectId: 'L1', userId: 'u-1', now: T });
    expect(report).toMatchObject({ works: { added: 2 }, excerpts: 0, notes: 0, aiSummaries: 1, unavailable: ['notes', 'highlights', 'relations', 'summary columns'] });
    expect(await repo.getOutput(legacyIds.notesOutput('L1'))).toBeNull();
  });
});
