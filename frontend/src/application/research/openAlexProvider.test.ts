import { describe, expect, it } from 'vitest';
import type { QuerySpec } from '../../domain/research';
import { buildSearchClause } from './openAlexProvider';

function spec(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    id: 'qs-1',
    projectId: 'p-1',
    question: '',
    concepts: [],
    includeTerms: [],
    excludeTerms: [],
    languages: [],
    seedWorkIds: [],
    strategy: 'explore',
    aiAssisted: false,
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildSearchClause', () => {
  it('sends a natural-language question as free text, not an exact phrase', () => {
    const clause = buildSearchClause(spec({ question: 'How does sleep affect memory consolidation?' }));
    expect(clause).toBe('How does sleep affect memory consolidation?');
    expect(clause).not.toContain('"');
  });

  it('drops stray double quotes and collapses whitespace in the question', () => {
    expect(buildSearchClause(spec({ question: '  sleep   "and" memory ' }))).toBe('sleep and memory');
  });

  it('groups the question when it is combined with concepts', () => {
    const clause = buildSearchClause(
      spec({ question: 'sleep and recall', concepts: [{ label: 'REM sleep', synonyms: ['slumber'] }] }),
    );
    expect(clause).toBe('("REM sleep" OR slumber) AND (sleep and recall)');
  });

  it('returns an empty clause for an empty question and no concepts', () => {
    expect(buildSearchClause(spec({ question: '   ' }))).toBe('');
  });
});
