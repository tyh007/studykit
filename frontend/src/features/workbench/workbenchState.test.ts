import { describe, expect, it } from 'vitest';
import {
  activateEditor,
  activeInput,
  closeEditor,
  createWorkbenchState,
  isRevealed,
  openEditor,
  parseWorkbenchState,
  pinEditor,
  revealRegion,
  serializeWorkbenchState,
  setSideWidth,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_MIN,
  type EditorInput,
} from './workbenchState';

const P = 'proj-1';
const overview: EditorInput = { kind: 'overview', id: P };
const workA: EditorInput = { kind: 'work', id: 'w-a' };
const workB: EditorInput = { kind: 'work', id: 'w-b' };
const evidence: EditorInput = { kind: 'evidence', id: P };

const keys = (s: ReturnType<typeof createWorkbenchState>): string[] =>
  s.tabs.map((t) => `${t.input.kind}:${t.input.id}${t.preview ? '*' : ''}`);

describe('workbench state: opening editors', () => {
  it('starts empty with no active tab', () => {
    const s = createWorkbenchState(P);
    expect(s.tabs).toEqual([]);
    expect(s.active).toBe(-1);
    expect(activeInput(s)).toBeNull();
  });

  it('opens a regular tab after the active one and focuses it', () => {
    let s = openEditor(createWorkbenchState(P), overview);
    s = openEditor(s, evidence);
    s = activateEditor(s, 0);
    s = openEditor(s, workA);
    expect(keys(s)).toEqual(['overview:proj-1', 'work:w-a', 'evidence:proj-1']);
    expect(activeInput(s)).toEqual(workA);
  });

  it('focuses an already-open editor instead of duplicating it', () => {
    let s = openEditor(createWorkbenchState(P), overview);
    s = openEditor(s, workA);
    s = openEditor(s, overview);
    expect(keys(s)).toEqual(['overview:proj-1', 'work:w-a']);
    expect(s.active).toBe(0);
  });

  it('replaces the preview tab in place when previewing another item', () => {
    let s = openEditor(createWorkbenchState(P), overview);
    s = openEditor(s, workA, { preview: true });
    s = openEditor(s, workB, { preview: true });
    expect(keys(s)).toEqual(['overview:proj-1', 'work:w-b*']);
    expect(activeInput(s)).toEqual(workB);
  });

  it('pins a preview tab when the same item is opened normally', () => {
    let s = openEditor(createWorkbenchState(P), workA, { preview: true });
    s = openEditor(s, workA);
    expect(keys(s)).toEqual(['work:w-a']);
    s = openEditor(s, workB, { preview: true });
    expect(keys(s)).toEqual(['work:w-a', 'work:w-b*']);
  });

  it('pinEditor keeps a preview tab', () => {
    let s = openEditor(createWorkbenchState(P), workA, { preview: true });
    s = pinEditor(s, 0);
    expect(s.tabs[0]?.preview).toBe(false);
  });

  it('refreshes params when an open editor is requested again', () => {
    let s = openEditor(createWorkbenchState(P), { kind: 'design', id: P });
    s = openEditor(s, { kind: 'design', id: P, params: { question: 'q-1' } });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.input.params).toEqual({ question: 'q-1' });
  });
});

describe('workbench state: closing editors', () => {
  const three = (): ReturnType<typeof createWorkbenchState> => {
    let s = openEditor(createWorkbenchState(P), overview);
    s = openEditor(s, workA);
    return openEditor(s, evidence);
  };

  it('moves focus to the right neighbour when closing the active tab', () => {
    let s = activateEditor(three(), 1);
    s = closeEditor(s, 1);
    expect(keys(s)).toEqual(['overview:proj-1', 'evidence:proj-1']);
    expect(activeInput(s)).toEqual(evidence);
  });

  it('moves focus left when the active tab was last', () => {
    const s = closeEditor(three(), 2);
    expect(activeInput(s)).toEqual(workA);
  });

  it('keeps the same editor active when closing a tab before it', () => {
    const s = closeEditor(three(), 0);
    expect(activeInput(s)).toEqual(evidence);
  });

  it('has no active tab after closing the last one', () => {
    const s = closeEditor(openEditor(createWorkbenchState(P), overview), 0);
    expect(s.active).toBe(-1);
  });

  it('ignores out-of-range indexes', () => {
    const s = three();
    expect(closeEditor(s, 9)).toBe(s);
    expect(activateEditor(s, -1)).toBe(s);
  });
});

describe('workbench state: layout', () => {
  it('clamps the side bar width', () => {
    const s = createWorkbenchState(P);
    expect(setSideWidth(s, 10).sideWidth).toBe(SIDE_WIDTH_MIN);
    expect(setSideWidth(s, 5000).sideWidth).toBe(SIDE_WIDTH_MAX);
  });

  it('remembers revealed regions once', () => {
    let s = revealRegion(createWorkbenchState(P), 'canvas');
    s = revealRegion(s, 'canvas');
    expect(s.revealed).toEqual(['canvas']);
    expect(isRevealed(s, 'canvas')).toBe(true);
    expect(isRevealed(s, 'design')).toBe(false);
  });
});

describe('workbench state: persistence', () => {
  it('round-trips tabs, active tab, layout and revealed regions', () => {
    let s = openEditor(createWorkbenchState(P), overview);
    s = openEditor(s, { kind: 'design', id: P, params: { question: 'q-1' } });
    s = openEditor(s, workA, { preview: true });
    s = activateEditor(s, 1);
    s = setSideWidth(s, 320);
    s = revealRegion(s, 'design');
    const restored = parseWorkbenchState(serializeWorkbenchState(s), P);
    expect(restored).toEqual(s);
  });

  it('drops transient params so one-shot requests are not replayed', () => {
    const s = openEditor(createWorkbenchState(P), { kind: 'library', id: P, params: { add: '1', view: 'x' } });
    const restored = parseWorkbenchState(serializeWorkbenchState(s, { transientParams: ['add'] }), P);
    expect(restored.tabs[0]?.input.params).toEqual({ view: 'x' });
    const onlyTransient = openEditor(createWorkbenchState(P), { kind: 'library', id: P, params: { add: '1' } });
    const restored2 = parseWorkbenchState(serializeWorkbenchState(onlyTransient, { transientParams: ['add'] }), P);
    expect(restored2.tabs[0]?.input.params).toBeUndefined();
  });

  it('falls back to a fresh state for missing, malformed or foreign data', () => {
    const fresh = createWorkbenchState(P);
    expect(parseWorkbenchState(null, P)).toEqual(fresh);
    expect(parseWorkbenchState('{not json', P)).toEqual(fresh);
    expect(parseWorkbenchState(JSON.stringify({ v: 99, projectId: P, tabs: [] }), P)).toEqual(fresh);
    const other = serializeWorkbenchState(openEditor(createWorkbenchState('other'), overview));
    expect(parseWorkbenchState(other, P)).toEqual(fresh);
  });

  it('skips invalid and duplicate tabs and repairs the active index', () => {
    const raw = JSON.stringify({
      v: 1,
      projectId: P,
      tabs: [{ kind: 'work', id: 'w-a' }, { kind: '', id: 'x' }, { kind: 'work', id: 'w-a' }, { id: 'no-kind' }],
      active: 7,
      sideOpen: 'yes',
      sideWidth: 'wide',
      revealed: ['canvas', 'bogus', 'canvas'],
    });
    const s = parseWorkbenchState(raw, P);
    expect(keys(s)).toEqual(['work:w-a']);
    expect(s.active).toBe(0);
    expect(s.sideOpen).toBe(true);
    expect(s.revealed).toEqual(['canvas']);
  });
});
