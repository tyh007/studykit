/**
 * StudyKit v0.4 — `domain/canvas` contract tests (WP-06).
 *
 * Pure-type contract tests. No React, no Dexie. The point
 * of this file is to lock down the cognitive-canvas
 * vocabulary so future code (application use cases,
 * repository adapters, UI features) cannot drift.
 */

import { describe, expect, it } from 'vitest';

import {
  CANVAS_OBJECT_REF_KINDS,
  CANVAS_VIEW_MODES,
  COGNITIVE_ROLES,
  RELATION_KINDS,
  RELATION_STATUSES,
  defaultCognitiveRole,
  freeRef,
  isCanvasObjectRef,
  isCanvasViewMode,
  isCognitiveRole,
  isRelationKind,
  isRelationStatus,
  knowledgeRef,
  parseRefKey,
  refKey,
  sameRef,
} from './canvas';

describe('domain/canvas — object refs', () => {
  it('accepts free refs and rejects empty ids', () => {
    expect(isCanvasObjectRef(freeRef('a1'))).toBe(true);
    expect(isCanvasObjectRef({ kind: 'free', id: '' })).toBe(false);
    expect(isCanvasObjectRef({ kind: 'free' })).toBe(false);
  });

  it('accepts knowledge refs with a known objectKind', () => {
    expect(isCanvasObjectRef(knowledgeRef('w1', 'evidence'))).toBe(true);
    expect(isCanvasObjectRef(knowledgeRef('w1', 'claim'))).toBe(true);
  });

  it('rejects unknown objectKind', () => {
    expect(isCanvasObjectRef({ kind: 'knowledge', id: 'w1', objectKind: 'bogus' })).toBe(
      false,
    );
  });

  it('rejects non-objects', () => {
    expect(isCanvasObjectRef(null)).toBe(false);
    expect(isCanvasObjectRef('free:abc')).toBe(false);
    expect(isCanvasObjectRef(undefined)).toBe(false);
  });

  it('exposes the spec §4 ref kinds as a closed list', () => {
    expect([...CANVAS_OBJECT_REF_KINDS].sort()).toEqual(['free', 'knowledge']);
  });

  it('round-trips refKey / parseRefKey for free refs', () => {
    const ref = freeRef('abc');
    const key = refKey(ref);
    expect(key).toBe('free:abc');
    const back = parseRefKey(key);
    expect(back).toEqual(ref);
  });

  it('treats free:<id> and knowledge:<id> as distinct keys', () => {
    expect(refKey(freeRef('abc'))).not.toBe(refKey(knowledgeRef('abc', 'note')));
  });
});

describe('domain/canvas — cognitive roles', () => {
  it('exposes the spec §8.2 role list verbatim', () => {
    expect([...COGNITIVE_ROLES].sort()).toEqual(
      [
        'claim',
        'concept',
        'counterevidence',
        'evidence',
        'example',
        'free',
        'output',
        'question',
        'source',
        'task',
      ].sort(),
    );
  });

  it('default role maps a `note` object to the `free` cognitive role', () => {
    // A note is open-ended; until the user upgrades it the
    // canvas treats it as a free node.
    expect(defaultCognitiveRole('note')).toBe('free');
  });

  it('default role is identity for the rest', () => {
    for (const kind of [
      'source',
      'concept',
      'question',
      'claim',
      'evidence',
      'task',
      'output',
    ] as const) {
      expect(defaultCognitiveRole(kind)).toBe(kind);
    }
  });

  it('isCognitiveRole rejects unknown values', () => {
    expect(isCognitiveRole('free')).toBe(true);
    expect(isCognitiveRole('bogus')).toBe(false);
    expect(isCognitiveRole(null)).toBe(false);
  });
});

describe('domain/canvas — view modes', () => {
  it('exposes exactly spatial and outline', () => {
    expect([...CANVAS_VIEW_MODES].sort()).toEqual(['outline', 'spatial']);
  });

  it('isCanvasViewMode guards', () => {
    expect(isCanvasViewMode('spatial')).toBe(true);
    expect(isCanvasViewMode('outline')).toBe(true);
    expect(isCanvasViewMode('grid')).toBe(false);
  });
});

describe('domain/canvas — relation vocabulary', () => {
  it('exposes the spec §8.3 relation kinds (including `untyped`)', () => {
    expect(RELATION_KINDS).toContain('explains');
    expect(RELATION_KINDS).toContain('example-of');
    expect(RELATION_KINDS).toContain('causes');
    expect(RELATION_KINDS).toContain('depends-on');
    expect(RELATION_KINDS).toContain('supports');
    expect(RELATION_KINDS).toContain('contradicts');
    expect(RELATION_KINDS).toContain('qualifies');
    expect(RELATION_KINDS).toContain('extends');
    expect(RELATION_KINDS).toContain('compares-with');
    expect(RELATION_KINDS).toContain('answers');
    expect(RELATION_KINDS).toContain('raises');
    expect(RELATION_KINDS).toContain('derived-from');
    expect(RELATION_KINDS).toContain('part-of');
    expect(RELATION_KINDS).toContain('next-step-for');
    // `untyped` is the visual-only default.
    expect(RELATION_KINDS).toContain('untyped');
  });

  it('isRelationKind guards', () => {
    expect(isRelationKind('supports')).toBe(true);
    expect(isRelationKind('magic')).toBe(false);
  });

  it('exposes the preview / accepted / rejected lifecycle', () => {
    expect([...RELATION_STATUSES].sort()).toEqual(['accepted', 'preview', 'rejected']);
    expect(isRelationStatus('preview')).toBe(true);
    expect(isRelationStatus('accepted')).toBe(true);
    expect(isRelationStatus('rejected')).toBe(true);
    expect(isRelationStatus('floating')).toBe(false);
  });
});

describe('domain/canvas — ref equality', () => {
  it('sameRef treats two free refs as equal iff their ids match', () => {
    expect(sameRef(freeRef('a'), freeRef('a'))).toBe(true);
    expect(sameRef(freeRef('a'), freeRef('b'))).toBe(false);
  });

  it('sameRef treats two knowledge refs as equal iff id and objectKind match', () => {
    expect(sameRef(knowledgeRef('a', 'evidence'), knowledgeRef('a', 'evidence'))).toBe(true);
    expect(sameRef(knowledgeRef('a', 'evidence'), knowledgeRef('a', 'claim'))).toBe(false);
  });

  it('sameRef never conflates a free ref with a knowledge ref', () => {
    expect(sameRef(freeRef('a'), knowledgeRef('a', 'note'))).toBe(false);
  });
});
