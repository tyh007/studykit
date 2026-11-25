import { describe, expect, it } from 'vitest';

import {
  DRAFT_STATUSES,
  DRAFT_TARGET_KINDS,
  isAIDraft,
  isDraftOrigin,
  isDraftProvenance,
  isDraftStatus,
  isDraftTarget,
  isDraftTargetKind,
  isTerminalDraftStatus,
} from './draft';
import { makeAIDraft, makeProvenance } from './__fixtures__/domain-fixtures';

describe('draft domain contract', () => {
  it('exposes the four statuses from D-008', () => {
    expect([...DRAFT_STATUSES].sort()).toEqual([
      'accepted',
      'pending',
      'rejected',
      'superseded',
    ]);
  });

  it('isDraftStatus accepts only the four declared statuses', () => {
    for (const status of DRAFT_STATUSES) {
      expect(isDraftStatus(status)).toBe(true);
    }
    expect(isDraftStatus('unknown')).toBe(false);
    expect(isDraftStatus(null)).toBe(false);
  });

  it('DRAFT_TARGET_KINDS covers the seven canonical object kinds a draft can produce', () => {
    expect([...DRAFT_TARGET_KINDS].sort()).toEqual([
      'claim',
      'concept',
      'evidence',
      'note',
      'output',
      'question',
      'task',
    ]);
  });

  it('isDraftTargetKind is a closed guard', () => {
    for (const kind of DRAFT_TARGET_KINDS) {
      expect(isDraftTargetKind(kind)).toBe(true);
    }
    expect(isDraftTargetKind('source')).toBe(false); // 'source' is not draftable in v0.4
    expect(isDraftTargetKind('mystery')).toBe(false);
    expect(isDraftTargetKind(null)).toBe(false);
  });

  it('isDraftProvenance accepts a full provenance block', () => {
    expect(isDraftProvenance(makeProvenance())).toBe(true);
  });

  it('isDraftProvenance rejects missing or wrong-typed fields', () => {
    expect(isDraftProvenance(null)).toBe(false);
    expect(isDraftProvenance({})).toBe(false);
    expect(isDraftProvenance({ provider: 1, generatedAt: '', sourceScope: [], origin: { kind: 'imported' } })).toBe(false);
    expect(
      isDraftProvenance({
        provider: 'ollama',
        generatedAt: '',
        sourceScope: 'not-an-array',
        origin: { kind: 'imported' },
      }),
    ).toBe(false);
  });

  it('isDraftOrigin covers every origin kind', () => {
    expect(isDraftOrigin({ kind: 'selection', objectId: 'o-1' })).toBe(true);
    expect(isDraftOrigin({ kind: 'intent-capsule', intentId: 'i-1' })).toBe(true);
    expect(isDraftOrigin({ kind: 'transition-suggestion', transitionId: 't-1' })).toBe(true);
    expect(isDraftOrigin({ kind: 'background-job', jobId: 'j-1' })).toBe(true);
    expect(isDraftOrigin({ kind: 'imported' })).toBe(true);
    expect(isDraftOrigin({ kind: 'mystery' })).toBe(false);
    expect(isDraftOrigin(null)).toBe(false);
  });

  it('isDraftTarget accepts a well-formed target and rejects malformed ones', () => {
    expect(
      isDraftTarget({ targetObjectId: 'o-1', targetKind: 'note' }),
    ).toBe(true);
    for (const kind of DRAFT_TARGET_KINDS) {
      expect(isDraftTarget({ targetObjectId: 'o-1', targetKind: kind })).toBe(true);
    }
    // Missing targetObjectId
    expect(isDraftTarget({ targetKind: 'note' })).toBe(false);
    // Wrong type
    expect(isDraftTarget({ targetObjectId: 42, targetKind: 'note' })).toBe(false);
    expect(isDraftTarget({ targetObjectId: 'o-1', targetKind: 42 })).toBe(false);
    // Empty targetObjectId is rejected — every draft must name its target.
    expect(isDraftTarget({ targetObjectId: '', targetKind: 'note' })).toBe(false);
    // Unknown kind
    expect(isDraftTarget({ targetObjectId: 'o-1', targetKind: 'mystery' })).toBe(false);
    // Not an object
    expect(isDraftTarget(null)).toBe(false);
    expect(isDraftTarget('not-an-object')).toBe(false);
  });

  it('AIDraft round-trips through JSON', () => {
    const original = makeAIDraft();
    const restored = JSON.parse(JSON.stringify(original));
    expect(isAIDraft(restored)).toBe(true);
    expect(restored).toEqual(original);
  });

  it('isAIDraft rejects malformed drafts', () => {
    expect(isAIDraft(null)).toBe(false);
    expect(isAIDraft({ ...makeAIDraft(), status: 'mystery' })).toBe(false);
    expect(isAIDraft({ ...makeAIDraft(), body: 42 })).toBe(false);
    expect(isAIDraft({ ...makeAIDraft(), target: null })).toBe(false);
  });

  it('isAIDraft rejects drafts whose target fails isDraftTarget (id, kind, presence)', () => {
    // missing targetObjectId
    expect(
      isAIDraft({ ...makeAIDraft(), target: { targetKind: 'note' } }),
    ).toBe(false);
    // wrong type for targetObjectId
    expect(
      isAIDraft({
        ...makeAIDraft(),
        target: { targetObjectId: 42, targetKind: 'note' },
      }),
    ).toBe(false);
    // empty targetObjectId
    expect(
      isAIDraft({ ...makeAIDraft(), target: { targetObjectId: '', targetKind: 'note' } }),
    ).toBe(false);
    // unknown targetKind
    expect(
      isAIDraft({
        ...makeAIDraft(),
        target: { targetObjectId: 'o-1', targetKind: 'mystery' },
      }),
    ).toBe(false);
    // 'source' is not a valid draft target kind
    expect(
      isAIDraft({
        ...makeAIDraft(),
        target: { targetObjectId: 'o-1', targetKind: 'source' },
      }),
    ).toBe(false);
  });

  it('only terminal statuses are non-pending and non-runnable', () => {
    expect(isTerminalDraftStatus('pending')).toBe(false);
    expect(isTerminalDraftStatus('accepted')).toBe(true);
    expect(isTerminalDraftStatus('rejected')).toBe(true);
    expect(isTerminalDraftStatus('superseded')).toBe(true);
  });
});
