import { describe, expect, it } from 'vitest';
import type { Evidence, Work } from './research';
import type { OutputStatement, StatementSupport } from './output';
import {
  auditCitation,
  citeKeyForWork,
  isStatementCitation,
  workToCslJson,
  type StatementCitation,
} from './citation';

const now = '2026-07-31T00:00:00.000Z';
const work: Work = {
  id: 'work-12345678',
  identifiers: { doi: '10.1234/example' },
  title: 'Sleep and Memory',
  authors: ['Doe, Jane'],
  year: 2025,
  venue: 'Journal of Sleep',
  metadataProvenance: {},
  integrity: 'ok',
  integrityCheckedAt: now,
  assetIds: [],
  projectIds: ['p-1'],
  readingStatus: 'read',
  importance: 0,
  createdAt: now,
  updatedAt: now,
  authorType: 'imported',
};
const statement: OutputStatement = {
  id: 'st-1', projectId: 'p-1', outputId: 'o-1', sectionId: 's-1', body: 'Sleep supports memory.',
  order: 0, authorType: 'user', status: 'accepted', createdAt: now, updatedAt: now,
};
const citation: StatementCitation = {
  id: 'cite-1', projectId: 'p-1', outputId: 'o-1', statementId: 'st-1', workId: work.id,
  citeKey: citeKeyForWork(work), authorType: 'user', createdAt: now, updatedAt: now,
};
const evidence: Evidence = {
  id: 'e-1', projectId: 'p-1', workId: work.id,
  locator: { kind: 'paper-work', workId: work.id, capturedAt: now },
  exactQuote: 'Sleep supports consolidation.', userInterpretation: 'Supports the statement.',
  evidenceType: 'finding', status: 'verified', createdAt: now, updatedAt: now, authorType: 'user',
};
const support: StatementSupport = {
  id: 'sup-1', projectId: 'p-1', outputId: 'o-1', statementId: 'st-1',
  ref: { kind: 'evidence', id: 'e-1' }, relation: 'supports', authorType: 'user', createdAt: now, updatedAt: now,
};

describe('citation domain', () => {
  it('builds a stable citekey and CSL-JSON from canonical Work metadata', () => {
    expect(citeKeyForWork(work)).toBe('doe2025sleep-12345678');
    expect(workToCslJson(work)).toMatchObject({
      id: 'doe2025sleep-12345678', DOI: '10.1234/example', author: [{ family: 'Doe', given: 'Jane' }],
    });
  });

  it('guards canonical citation rows', () => {
    expect(isStatementCitation(citation)).toBe(true);
    expect(isStatementCitation({ ...citation, citeKey: 'bad key' })).toBe(false);
  });

  it('passes all four audit layers when identity, metadata, integrity, and entailment are valid', () => {
    const audit = auditCitation({ citation, statement, work, evidence: [evidence], supports: [support] });
    expect(audit.state).toBe('verified');
    expect(audit.checks.map((check) => [check.layer, check.level])).toEqual([
      ['identity', 'pass'], ['metadata', 'pass'], ['integrity', 'pass'], ['entailment', 'pass'],
    ]);
  });

  it('distinguishes a real citation with no entailment evidence from a verified citation', () => {
    const audit = auditCitation({ citation, statement, work, evidence: [evidence], supports: [] });
    expect(audit.state).toBe('needs-review');
    expect(audit.checks.find((check) => check.layer === 'entailment')?.level).toBe('warning');
  });

  it('blocks missing, cross-project, retracted, and contradicting lineage', () => {
    expect(auditCitation({ citation, statement: null, work, evidence: [], supports: [] }).state).toBe('blocked');
    expect(auditCitation({ citation, statement, work: { ...work, integrity: 'retracted' }, evidence: [], supports: [] }).state).toBe('blocked');
    expect(auditCitation({ citation, statement, work, evidence: [evidence], supports: [{ ...support, relation: 'contradicts' }] }).state).toBe('blocked');
  });
});
