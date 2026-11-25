/**
 * StudyKit v0.4 — `domain/output.test`
 *
 * Pure-function tests for the Output domain model.
 * No React, no Dexie, no Tauri, no fetch. Every
 * helper is exercised in isolation.
 */

import { describe, expect, it } from 'vitest';
import {
  auditOutput,
  auditStatement,
  auditTone,
  auditLabel,
  isOutputDocument,
  isOutputSection,
  isOutputStatement,
  isStatementRef,
  isStatementSupport,
  isStatementStatus,
  isSupportRelation,
  isOutputAuthorType,
  isOutputStatus,
  isFiniteOrder,
  stableSectionOrder,
  stableStatementOrder,
  strongerAuditState,
  supportDedupKey,
  validateOrder,
} from './output';

describe('isOutputStatus', () => {
  it('accepts outline, draft, final', () => {
    for (const v of ['outline', 'draft', 'final'] as const) {
      expect(isOutputStatus(v)).toBe(true);
    }
  });
  it('rejects unknowns', () => {
    expect(isOutputStatus('ready')).toBe(false);
    expect(isOutputStatus(undefined)).toBe(false);
    expect(isOutputStatus(null)).toBe(false);
  });
});

describe('isOutputAuthorType', () => {
  it('accepts user, ai, imported', () => {
    expect(isOutputAuthorType('user')).toBe(true);
    expect(isOutputAuthorType('ai')).toBe(true);
    expect(isOutputAuthorType('imported')).toBe(true);
  });
  it('rejects unknowns', () => {
    expect(isOutputAuthorType('bot')).toBe(false);
    expect(isOutputAuthorType(undefined)).toBe(false);
  });
});

describe('isStatementStatus', () => {
  it('accepts draft, accepted', () => {
    expect(isStatementStatus('draft')).toBe(true);
    expect(isStatementStatus('accepted')).toBe(true);
  });
  it('rejects unknowns', () => {
    expect(isStatementStatus('rejected')).toBe(false);
  });
});

describe('isSupportRelation', () => {
  it('accepts supports, contradicts, qualifies', () => {
    expect(isSupportRelation('supports')).toBe(true);
    expect(isSupportRelation('contradicts')).toBe(true);
    expect(isSupportRelation('qualifies')).toBe(true);
  });
  it('rejects unknowns', () => {
    expect(isSupportRelation('related')).toBe(false);
  });
});

describe('isStatementRef', () => {
  it('accepts { kind: claim, id } and { kind: evidence, id }', () => {
    expect(isStatementRef({ kind: 'claim', id: 'c-1' })).toBe(true);
    expect(isStatementRef({ kind: 'evidence', id: 'e-1' })).toBe(true);
  });
  it('rejects missing / empty / unknown kind or id', () => {
    expect(isStatementRef({ kind: 'claim', id: '' })).toBe(false);
    expect(isStatementRef({ kind: 'evidence', id: '' })).toBe(false);
    expect(isStatementRef({ kind: 'note', id: 'n-1' })).toBe(false);
    expect(isStatementRef({ id: 'c-1' })).toBe(false);
  });
});

describe('isOutputDocument', () => {
  const good = {
    id: 'o-1',
    projectId: 'p-1',
    title: 'Hello',
    status: 'draft' as const,
    authorType: 'user' as const,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  it('accepts a well-formed document', () => {
    expect(isOutputDocument(good)).toBe(true);
  });
  it('rejects empty id / projectId / title', () => {
    expect(isOutputDocument({ ...good, id: '' })).toBe(false);
    expect(isOutputDocument({ ...good, projectId: '' })).toBe(false);
    expect(isOutputDocument({ ...good, title: '' })).toBe(false);
  });
  it('rejects invalid timestamps', () => {
    expect(isOutputDocument({ ...good, createdAt: 'yesterday' })).toBe(false);
    expect(isOutputDocument({ ...good, updatedAt: '' })).toBe(false);
  });
  it('refuses AI-authored final', () => {
    expect(isOutputDocument({ ...good, authorType: 'ai', status: 'final' })).toBe(false);
  });
});

describe('isOutputSection', () => {
  const good = {
    id: 's-1',
    projectId: 'p-1',
    outputId: 'o-1',
    title: 'Intro',
    order: 0,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  it('accepts a well-formed section', () => {
    expect(isOutputSection(good)).toBe(true);
  });
  it('rejects NaN / negative / non-finite order', () => {
    expect(isOutputSection({ ...good, order: NaN })).toBe(false);
    expect(isOutputSection({ ...good, order: -1 })).toBe(false);
    expect(isOutputSection({ ...good, order: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe('isOutputStatement', () => {
  const good = {
    id: 'st-1',
    projectId: 'p-1',
    outputId: 'o-1',
    sectionId: 's-1',
    body: 'A claim.',
    order: 0,
    authorType: 'user' as const,
    status: 'draft' as const,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  it('accepts a non-empty body', () => {
    expect(isOutputStatement(good)).toBe(true);
  });
  it('rejects empty body', () => {
    expect(isOutputStatement({ ...good, body: '' })).toBe(false);
    expect(isOutputStatement({ ...good, body: '   ' })).toBe(false);
  });
  it('refuses AI authorType — only the Draft Layer may carry AI text', () => {
    expect(isOutputStatement({ ...good, authorType: 'ai' })).toBe(false);
  });
});

describe('isStatementSupport', () => {
  const good = {
    id: 'sup-1',
    projectId: 'p-1',
    outputId: 'o-1',
    statementId: 'st-1',
    ref: { kind: 'evidence' as const, id: 'e-1' },
    relation: 'supports' as const,
    authorType: 'user' as const,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  it('accepts a well-formed support', () => {
    expect(isStatementSupport(good)).toBe(true);
  });
  it('rejects unknown ref / relation', () => {
    expect(isStatementSupport({ ...good, ref: { kind: 'note', id: 'n' } })).toBe(false);
    expect(isStatementSupport({ ...good, relation: 'related' })).toBe(false);
  });
});

describe('isFiniteOrder / validateOrder', () => {
  it('accepts 0 and positive integers', () => {
    expect(isFiniteOrder(0)).toBe(true);
    expect(isFiniteOrder(42)).toBe(true);
    expect(isFiniteOrder(0.5)).toBe(true);
  });
  it('rejects NaN, Infinity, negative', () => {
    expect(isFiniteOrder(NaN)).toBe(false);
    expect(isFiniteOrder(-1)).toBe(false);
    expect(isFiniteOrder(Infinity)).toBe(false);
    expect(isFiniteOrder('0')).toBe(false);
  });
  it('validateOrder throws on bad input', () => {
    expect(() => validateOrder(NaN)).toThrow(/finite/);
    expect(() => validateOrder(-1)).toThrow(/finite/);
    expect(validateOrder(0)).toBe(0);
  });
});

describe('stable ordering', () => {
  const sectionA = {
    id: 's-1',
    projectId: 'p-1',
    outputId: 'o-1',
    title: 'A',
    order: 0,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  const sectionB = { ...sectionA, id: 's-2', title: 'B' };
  const sectionC = { ...sectionA, id: 's-3', title: 'C', createdAt: '2026-07-31T00:00:00.000Z' };

  it('orders by order first', () => {
    const sorted = stableSectionOrder([sectionC, sectionA, sectionB]);
    expect(sorted.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3']);
  });

  it('tiebreaks by createdAt then id', () => {
    const sameOrder = { ...sectionB, createdAt: '2026-07-30T00:00:00.000Z' };
    const sorted = stableSectionOrder([sameOrder, sectionA]);
    expect(sorted.map((s) => s.id)).toEqual(['s-1', 's-2']);
  });

  it('does not mutate the input', () => {
    const input = [sectionC, sectionA];
    const before = [...input];
    stableSectionOrder(input);
    expect(input).toEqual(before);
  });

  it('stableStatementOrder mirrors stableSectionOrder', () => {
    const statementA = {
      id: 'st-1',
      projectId: 'p-1',
      outputId: 'o-1',
      sectionId: 's-1',
      body: 'a',
      order: 0,
      authorType: 'user' as const,
      status: 'draft' as const,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    const statementB = { ...statementA, id: 'st-2', body: 'b', order: 1 };
    const sorted = stableStatementOrder([statementB, statementA]);
    expect(sorted.map((s) => s.id)).toEqual(['st-1', 'st-2']);
  });
});

describe('supportDedupKey', () => {
  it('produces a stable key per (statement, ref, relation)', () => {
    const a = supportDedupKey({
      statementId: 'st-1',
      ref: { kind: 'claim', id: 'c-1' },
      relation: 'supports',
    });
    const b = supportDedupKey({
      statementId: 'st-1',
      ref: { kind: 'claim', id: 'c-1' },
      relation: 'supports',
    });
    expect(a).toBe(b);
  });
  it('distinguishes different refs', () => {
    const a = supportDedupKey({
      statementId: 'st-1',
      ref: { kind: 'claim', id: 'c-1' },
      relation: 'supports',
    });
    const b = supportDedupKey({
      statementId: 'st-1',
      ref: { kind: 'evidence', id: 'e-1' },
      relation: 'supports',
    });
    expect(a).not.toBe(b);
  });
  it('distinguishes different relations', () => {
    const a = supportDedupKey({
      statementId: 'st-1',
      ref: { kind: 'claim', id: 'c-1' },
      relation: 'supports',
    });
    const b = supportDedupKey({
      statementId: 'st-1',
      ref: { kind: 'claim', id: 'c-1' },
      relation: 'contradicts',
    });
    expect(a).not.toBe(b);
  });
});

describe('auditStatement', () => {
  const statement = { id: 'st-1', projectId: 'p-1' };
  const claimA = { id: 'c-1', projectId: 'p-1', status: 'canonical' };
  const evA = { id: 'e-1', projectId: 'p-1', status: 'verified' };

  it('returns unsupported when no supports exist', () => {
    const audit = auditStatement({
      statement,
      supports: [],
      lookups: {
        claims: new Map([[claimA.id, claimA]]),
        evidence: new Map([[evA.id, evA]]),
      },
    });
    expect(audit.state).toBe('unsupported');
    expect(audit.reasons[0]).toMatchObject({ kind: 'no-supports' });
  });

  it('returns supported when one valid supports exists', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: evA.id },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([[evA.id, evA]]),
      },
    });
    expect(audit.state).toBe('supported');
    expect(audit.reasons).toEqual([]);
  });

  it('returns conflicted when a valid supports AND a valid contradicts exist', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: evA.id },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
        {
          id: 'sup-2',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: 'e-2' },
          relation: 'contradicts',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:01.000Z',
          updatedAt: '2026-07-30T00:00:01.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([
          [evA.id, evA],
          ['e-2', { id: 'e-2', projectId: 'p-1', status: 'verified' }],
        ]),
      },
    });
    expect(audit.state).toBe('conflicted');
  });

  it('returns broken when a ref is cross-project', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: 'e-other' },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([
          ['e-other', { id: 'e-other', projectId: 'p-other', status: 'verified' }],
        ]),
      },
    });
    expect(audit.state).toBe('broken');
    expect(audit.reasons[0]).toMatchObject({ kind: 'broken-ref' });
  });

  it('returns broken when a Claim is not canonical', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'claim', id: 'c-draft' },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
      lookups: {
        claims: new Map([['c-draft', { id: 'c-draft', projectId: 'p-1', status: 'draft' }]]),
        evidence: new Map(),
      },
    });
    expect(audit.state).toBe('broken');
    expect(audit.reasons[0]).toMatchObject({ kind: 'claim-not-accepted' });
  });

  it('returns broken when an Evidence is not verified', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: 'e-candidate' },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([
          ['e-candidate', { id: 'e-candidate', projectId: 'p-1', status: 'candidate' }],
        ]),
      },
    });
    expect(audit.state).toBe('broken');
    expect(audit.reasons[0]).toMatchObject({ kind: 'evidence-not-verified' });
  });

  it('returns unsupported when only contradicts exist', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: evA.id },
          relation: 'contradicts',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([[evA.id, evA]]),
      },
    });
    expect(audit.state).toBe('unsupported');
    expect(audit.reasons.some((r) => r.kind === 'only-contradicts')).toBe(true);
  });

  it('broken overrides conflicted', () => {
    const audit = auditStatement({
      statement,
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: evA.id },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
        {
          id: 'sup-2',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: 'st-1',
          ref: { kind: 'evidence', id: 'e-cross' },
          relation: 'contradicts',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:01.000Z',
          updatedAt: '2026-07-30T00:00:01.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([
          [evA.id, evA],
          ['e-cross', { id: 'e-cross', projectId: 'p-other', status: 'verified' }],
        ]),
      },
    });
    expect(audit.state).toBe('broken');
  });
});

describe('auditOutput', () => {
  const evA = { id: 'e-1', projectId: 'p-1', status: 'verified' };
  const stmtGood = {
    id: 'st-1',
    projectId: 'p-1',
    outputId: 'o-1',
    sectionId: 's-1',
    body: 'a',
    order: 0,
    authorType: 'user' as const,
    status: 'draft' as const,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  const stmtBroken = { ...stmtGood, id: 'st-2' };

  it('overall state is the strongest across statements', () => {
    const result = auditOutput({
      output: { id: 'o-1', projectId: 'p-1' },
      statements: [stmtGood, stmtBroken],
      supports: [
        {
          id: 'sup-1',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: stmtGood.id,
          ref: { kind: 'evidence', id: evA.id },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        },
        {
          id: 'sup-2',
          projectId: 'p-1',
          outputId: 'o-1',
          statementId: stmtBroken.id,
          ref: { kind: 'evidence', id: 'e-cross' },
          relation: 'supports',
          authorType: 'user',
          createdAt: '2026-07-30T00:00:01.000Z',
          updatedAt: '2026-07-30T00:00:01.000Z',
        },
      ],
      lookups: {
        claims: new Map(),
        evidence: new Map([
          [evA.id, evA],
          ['e-cross', { id: 'e-cross', projectId: 'p-other', status: 'verified' }],
        ]),
      },
    });
    expect(result.overall).toBe('broken');
    expect(result.byStatement.get(stmtGood.id)?.state).toBe('supported');
    expect(result.byStatement.get(stmtBroken.id)?.state).toBe('broken');
  });
});

describe('strongerAuditState', () => {
  it('returns the strongest of two states', () => {
    expect(strongerAuditState('supported', 'conflicted')).toBe('conflicted');
    expect(strongerAuditState('conflicted', 'broken')).toBe('broken');
    expect(strongerAuditState('unsupported', 'supported')).toBe('unsupported');
  });
});

describe('auditTone / auditLabel', () => {
  it('maps every state to a tone + label', () => {
    expect(auditTone('supported')).toBe('success');
    expect(auditTone('unsupported')).toBe('info');
    expect(auditTone('conflicted')).toBe('warning');
    expect(auditTone('broken')).toBe('error');
    expect(auditLabel('supported')).toMatch(/Supported/);
    expect(auditLabel('unsupported')).toMatch(/No evidence/);
    expect(auditLabel('conflicted')).toMatch(/Conflicted/);
    expect(auditLabel('broken')).toMatch(/Broken/);
  });
});