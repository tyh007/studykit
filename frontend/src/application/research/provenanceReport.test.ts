import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryResearchRepository } from './researchRepository';
import { loadProvenanceReport, reportToJson, reportToMarkdown } from './provenanceReport';
import { addPoint, citeInSlot, composeArgumentDraft, updatePoint } from './argument';
import { addStatement, addSection, createOutput, updateStatement } from '../output/outputUseCases';
import { classifySentence, isStatementOrigin, keptShare, quotesExcerpt } from '../../domain/provenance';
import type { OutputStatement } from '../../domain/output';
import { makeEvidence, makeResearchLocator, makeResearchProject, makeWork } from '../../domain/__fixtures__/domain-fixtures';

const P = 'p-001';
const QUOTE = 'Sleep after learning improved recall by twenty percent in young adults.';

describe('sentence sources', () => {
  it('tells AI drafts used as is from edited ones, then quotes, then own words', () => {
    const ai = { kind: 'ai' as const, provider: 'cloud', draftedAt: 'x', acceptedAt: 'y', aiText: 'Sleep helps  memory.' };
    expect(classifySentence({ body: 'Sleep helps memory.', origin: ai, quotes: [] })).toBe('ai-verbatim');
    expect(classifySentence({ body: 'Sleep may help memory.', origin: ai, quotes: [] })).toBe('ai-edited');
    expect(classifySentence({ body: `Walker found that “${QUOTE}”`, origin: { kind: 'written' }, quotes: [QUOTE] })).toBe('quoted');
    expect(classifySentence({ body: 'My own view.', origin: { kind: 'written' }, quotes: [QUOTE] })).toBe('own');
    expect(classifySentence({ body: 'Old text.', origin: undefined, quotes: [] })).toBe('unknown');
  });

  it('counts a partial quote, but not a few shared words', () => {
    expect(quotesExcerpt('As shown, sleep after learning improved recall by twenty percent.', QUOTE)).toBe(true);
    expect(quotesExcerpt('Sleep after learning matters.', QUOTE)).toBe(false);
  });

  it('measures how much of the AI text was kept', () => {
    expect(keptShare('a b c d', 'a b c d')).toBe(1);
    expect(keptShare('a b c d', 'a x c y')).toBe(0.5);
  });

  it('validates stored origins', () => {
    expect(isStatementOrigin({ kind: 'written' })).toBe(true);
    expect(isStatementOrigin({ kind: 'ai', provider: 'p', draftedAt: 'x', acceptedAt: 'y' })).toBe(false);
    expect(isStatementOrigin({ kind: 'argument' })).toBe(false);
  });
});

describe('provenance report', () => {
  let repo: MemoryResearchRepository;
  beforeEach(async () => {
    repo = new MemoryResearchRepository();
    await repo.transact(async (tx) => {
      tx.putProject(makeResearchProject({ id: P, name: 'Sleep and memory' }));
      tx.putWork(makeWork({ id: 'w-1', title: 'Sleep-dependent learning', authors: ['Walker'], year: 2004, identifiers: { doi: '10.1/x' }, projectIds: [P] }));
      tx.putEvidence(
        makeEvidence({ id: 'e-1', projectId: P, workId: 'w-1', status: 'verified', exactQuote: QUOTE, locator: makeResearchLocator({ workId: 'w-1', pageNumber: 11 }) }),
      );
      tx.putEvidence(
        makeEvidence({ id: 'e-ai', projectId: P, workId: 'w-1', status: 'verified', authorType: 'ai', exactQuote: 'Older adults were not tested in this study.', locator: makeResearchLocator({ workId: 'w-1', pageNumber: 12 }) }),
      );
    });
  });

  it('reports every paragraph’s source and backing, AI use in numbers, and checkable citations', async () => {
    // An argument turned into a draft: own words, cited.
    const point = await addPoint(repo, { projectId: P, title: 'Sleep helps memory' });
    await citeInSlot(repo, { projectId: P, claimId: point.id, slot: 'evidence', evidenceId: 'e-1' });
    await citeInSlot(repo, { projectId: P, claimId: point.id, slot: 'limits', evidenceId: 'e-ai' });
    await updatePoint(repo, { claimId: point.id, reasoning: 'Recall improves after a night of sleep', noCounter: true });
    const { output } = await composeArgumentDraft(repo, { projectId: P });

    // One typed paragraph with a quote, one accepted AI draft, edited.
    const [section] = await repo.listOutputSections({ outputId: output.id });
    const typed = await addStatement(repo, { sectionId: section!.id, body: `Walker reports that “${QUOTE}”` });
    const now = new Date().toISOString();
    const aiRow: OutputStatement = {
      ...typed,
      id: 'st-ai',
      order: 9,
      body: 'Sleep likely helps memory in young adults.',
      origin: { kind: 'ai', provider: 'cloud', model: 'm-1', draftedAt: now, acceptedAt: now, aiText: 'Sleep helps memory in all adults.' },
    };
    await repo.transact(async (tx) => tx.putOutputStatement(aiRow));
    // An edit later never changes the source.
    await updateStatement(repo, { statementId: typed.id, body: `Walker reports that “${QUOTE}” (my emphasis)` });

    const report = await loadProvenanceReport(repo, output.id, '2026-11-27T10:00:00.000Z');
    expect(report.sentences.map((s) => s.source)).toEqual(['own', 'own', 'quoted', 'ai-edited']);
    expect(report.bySource).toMatchObject({ own: 2, quoted: 1, 'ai-edited': 1, 'ai-verbatim': 0, unknown: 0 });
    expect(report.coverage).toMatchObject({ sentences: 4, backed: 2, unbacked: 2 });
    const ai = report.sentences[3]!;
    expect(ai.ai).toMatchObject({ provider: 'cloud', model: 'm-1' });
    expect(ai.aiWordsKept).toBeGreaterThan(0.5);
    expect(report.sentences[1]!.excerpts[0]).toMatchObject({ relation: 'qualifies', suggestedByAi: true, pageNumber: 12 });

    expect(report.ai).toMatchObject({ draftedSentences: 1, editedSentences: 1, verbatimSentences: 0, excerptsSuggested: 1, models: ['cloud (m-1)'] });
    expect(report.aiStatement).toContain('1 of 4 paragraphs began as AI drafts (1 edited by the author), generated with cloud (m-1)');
    expect(report.aiStatement).toContain('1 excerpt was first proposed by the AI; the author checked each against the source.');
    expect(report.aiStatement).toContain('All 2 cited excerpts were checked by the author against the source; each is listed with its page.');

    const md = reportToMarkdown(report);
    expect(md).toContain('# Provenance report — Draft from your argument');
    expect(md).toContain(`“${QUOTE}” — Walker (2004), Sleep-dependent learning, doi:10.1/x, p. 11`);
    expect(md).toContain('AI draft, edited by you · cloud (m-1)');
    expect(JSON.parse(reportToJson(report)).formatVersion).toBe(1);
  });

  it('says so when nothing came from the AI, and marks text from before sources were recorded', async () => {
    const output = await createOutput(repo, { projectId: P, title: 'Notes' });
    const section = await addSection(repo, { outputId: output.id, title: 'One' });
    const old = await addStatement(repo, { sectionId: section.id, body: 'Written long ago.' });
    const { origin: _drop, ...legacy } = old;
    void _drop;
    await repo.transact(async (tx) => tx.putOutputStatement(legacy));
    const report = await loadProvenanceReport(repo, output.id);
    expect(report.sentences[0]!.source).toBe('unknown');
    expect(report.aiStatement).toMatch(/^This text was written before StudyKit recorded where paragraphs came from, so their origin is not known\./);
    await addStatement(repo, { sectionId: section.id, body: 'Written today.' });
    const mixed = await loadProvenanceReport(repo, output.id);
    expect(mixed.aiStatement).toMatch(/^None of the 1 paragraph with a recorded source began as an AI draft\./);
    expect(mixed.aiStatement).toContain('1 paragraph was written before StudyKit recorded sources, so its origin is not known.');
  });
});
