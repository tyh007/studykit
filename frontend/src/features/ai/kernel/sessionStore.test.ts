import { beforeEach, describe, expect, it } from 'vitest';

import { assistantSession } from './sessionStore';
import type { DraftRecord } from './draftLayer';

function makeDraft(id: string): DraftRecord {
  return Object.freeze({
    id,
    status: 'draft' as const,
    title: id,
    body: { kind: 'text' as const, text: '...' },
    target: { targetId: id, kind: 'other' as const },
    provenance: {
      provider: 'local',
      actionId: 'a',
      contextSnapshotHash: '00000000',
      sourceScope: [] as readonly string[],
      invocationSurface: 'intent-capsule' as const,
      createdAt: new Date().toISOString(),
    },
    noUndo: false,
  });
}

describe('AssistantSessionStore', () => {
  beforeEach(() => {
    assistantSession.__resetForTests();
  });

  it('starts closed', () => {
    expect(assistantSession.getSnapshot().status).toBe('closed');
    expect(assistantSession.getSnapshot().isOpen).toBe(false);
  });

  it('open / close toggle isOpen and remember restoreFocusId', () => {
    assistantSession.open({ surface: 'intent-capsule', restoreFocusId: 'btn-1', initialPrompt: 'hi' });
    expect(assistantSession.getSnapshot().isOpen).toBe(true);
    expect(assistantSession.getSnapshot().restoreFocusId).toBe('btn-1');
    expect(assistantSession.getSnapshot().prompt).toBe('hi');
    assistantSession.close();
    expect(assistantSession.getSnapshot().isOpen).toBe(false);
    // close() does NOT clear the prompt — it persists across re-opens.
    expect(assistantSession.getSnapshot().prompt).toBe('hi');
  });

  it('setPrompt / setSelection mutate the snapshot', () => {
    assistantSession.open({ surface: 'intent-capsule' });
    assistantSession.setPrompt('explain this');
    assistantSession.setSelection({ text: 'passage', objectIds: ['a', 'b'] });
    const s = assistantSession.getSnapshot();
    expect(s.prompt).toBe('explain this');
    expect(s.selectedText).toBe('passage');
    expect(s.selectedObjectIds).toEqual(['a', 'b']);
  });

  it('pin / unpin context', () => {
    assistantSession.open({ surface: 'intent-capsule' });
    assistantSession.pinContext('x-1');
    assistantSession.pinContext('x-1'); // idempotent
    expect(assistantSession.getSnapshot().pinnedContextIds).toEqual(['x-1']);
    assistantSession.pinContext('x-2');
    expect(assistantSession.getSnapshot().pinnedContextIds).toEqual(['x-1', 'x-2']);
    assistantSession.unpinContext('x-1');
    expect(assistantSession.getSnapshot().pinnedContextIds).toEqual(['x-2']);
  });

  it('clearTransient drops selection but keeps pinned + prompt', () => {
    assistantSession.open({ surface: 'intent-capsule', initialPrompt: 'why' });
    assistantSession.setSelection({ text: 'a', objectIds: ['o'] });
    assistantSession.pinContext('p-1');
    assistantSession.clearTransient();
    const s = assistantSession.getSnapshot();
    expect(s.selectedText).toBeNull();
    expect(s.selectedObjectIds).toEqual([]);
    expect(s.pinnedContextIds).toEqual(['p-1']);
    expect(s.prompt).toBe('why');
    expect(s.scopePolicy).toBe('explicit-set');
  });

  it('setDraft transitions to reviewing; cancel goes back to open-idle and clears the draft', () => {
    assistantSession.open({ surface: 'intent-capsule' });
    assistantSession.setDraft(makeDraft('d-1'));
    expect(assistantSession.getSnapshot().status).toBe('reviewing');
    expect(assistantSession.getSnapshot().draft?.id).toBe('d-1');
    assistantSession.cancel();
    const s = assistantSession.getSnapshot();
    expect(s.draft).toBeNull();
    expect(s.status).toBe('open-idle');
  });

  it('setError is sticky; clear on next open', () => {
    assistantSession.open({ surface: 'intent-capsule' });
    assistantSession.setError('boom');
    expect(assistantSession.getSnapshot().status).toBe('error');
    expect(assistantSession.getSnapshot().error).toBe('boom');
    assistantSession.open({ surface: 'intent-capsule' });
    expect(assistantSession.getSnapshot().error).toBeNull();
  });

  it('close() is distinct from cancel(): close keeps the draft visible in memory', () => {
    assistantSession.open({ surface: 'intent-capsule' });
    assistantSession.setDraft(makeDraft('d-1'));
    assistantSession.close();
    const s = assistantSession.getSnapshot();
    expect(s.isOpen).toBe(false);
    // The draft reference is retained so the UI can show
    // "you have a pending review" hints, but the status
    // is no longer `reviewing` to avoid hidden state.
    expect(s.draft?.id).toBe('d-1');
  });
});
