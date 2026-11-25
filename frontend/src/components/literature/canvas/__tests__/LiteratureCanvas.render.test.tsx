/**
 * StudyKit v0.4 — `components/literature/canvas/__tests__/LiteratureCanvas.render`
 *
 * Real render coverage for the literature canvas
 * (WP-06 Round 6 P0-1; Round 8 audit: real production
 * control, no outer provider).
 *
 * The test renders the *real* `<LiteratureCanvas
 * projectId="…" />` directly (no external
 * `CanvasSurfaceProvider`, no `FlowProbe`, no
 * `useReactFlow` / `ReactFlowProvider` mock). The
 * canvas's own default export wraps
 * `LiteratureCanvasInner` in `<CanvasSurfaceProvider>`,
 * so a single `ReactFlowProvider` is in the tree
 * — exactly the production shape. An outer
 * provider would create a *second* store and a
 * test that reads from it would never see the
 * canvas's real viewport mutations.
 *
 * Two assertions, each real:
 *
 *   1. **No provider error.** The canvas mounts
 *      without `useReactFlow` throwing "no provider".
 *      We assert the `.react-flow__viewport`
 *      element renders.
 *   2. **Parent hook and surface share the store.**
 *      We trigger a real production control: the
 *      parent's keydown handler (around
 *      `LiteratureCanvas.tsx` ~372) calls
 *      `useSurfaceFlow().zoomIn(...)` for `Ctrl/Cmd+'`
 *      and `zoomOut(...)` for `Ctrl/Cmd+'-'`. The
 *      SAME `ReactFlowProvider` is the source of
 *      the surface's `<ReactFlow>` element. We
 *      fire the key event at the window and assert
 *      the `.react-flow__viewport` element's
 *      `style.transform` *actually changes*. A
 *      second `<ReactFlowProvider>` (or a missing
 *      one) would mean the parent's `zoomIn` hits a
 *      different store and the surface's transform
 *      stays put — the assertion fails.
 *
 * The Toolbar Fit button is a degenerate case in
 * happy-dom (the canvas has no nodes; the fit
 * either no-ops or stays at zoom 1). The parent's
 * keydown handler is the cleaner production control.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  render,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// We mock just the data API + the AI capability
// hook so the real `LiteratureCanvas` can mount
// under happy-dom. The xyflow primitives are NOT
// mocked — that's the whole point of this test.
vi.mock('../../../../application/dataApi', () => ({
  literatureCanvasApi: {
    listOrCreate: async (_projectId: string) => [
      {
        id: 'canvas-1',
        project_id: 'project-1',
        name: 'Test canvas',
        viewport_json: null,
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
      },
    ],
    state: async (_canvasId: string) => ({
      nodes: [],
      edges: [],
      scenes: [],
      groups: [],
    }),
    saveViewport: async () => undefined,
    updateViewport: async () => undefined,
    createNote: async () => ({ id: 'note-1' }),
    createEdge: async () => ({ id: 'edge-1' }),
    updateEdge: async () => ({ id: 'edge-1' }),
    deleteEdge: async () => undefined,
    createGroup: async () => ({ id: 'group-1' }),
    updateGroup: async () => undefined,
    deleteGroup: async () => undefined,
    setNodePosition: async () => undefined,
    addNode: async () => ({ id: 'node-1' }),
    addShape: async () => ({ id: 'shape-1' }),
    setNodeSize: async () => undefined,
    setNodeContent: async () => undefined,
    deleteNode: async () => undefined,
    addScene: async () => ({ id: 'scene-1' }),
    updateScene: async () => undefined,
    deleteScene: async () => undefined,
    insertAiAnswer: async () => undefined,
  },
  literaturePapersApi: {
    list: async () => [],
  },
}));

vi.mock('../../../../app/v04/CapabilityNotice', () => ({
  useCapability: () => ({ supported: true, tooltip: '' }),
}));

vi.mock('../../../../lib/literature-pdf-upload', () => ({
  uploadPDFFile: async () => ({ id: 'paper-1' }),
  validatePDFFiles: (files: File[]) => ({ valid: files, invalid: [] }),
}));

import LiteratureCanvas from '../LiteratureCanvas';

/** Read the live `style` attribute of the rendered
 *  `.react-flow__viewport` element. The parent +
 *  surface share a `ReactFlowProvider`, so
 *  mutating the parent's `useReactFlow` store
 *  must produce a new style on this element. */
function getViewportStyle(): string | null {
  const el = document.querySelector('.react-flow__viewport');
  if (!el) return null;
  return el.getAttribute('style');
}

describe('LiteratureCanvas — real render + shared xyflow store (P0-1)', () => {
  afterEach(() => {
    cleanup();
  });

  it('mounts directly (no outer provider) — no "no provider" error, surface renders a real ReactFlow viewport', async () => {
    // Render the canvas's *default* export — it
    // owns its own `CanvasSurfaceProvider`. The
    // parent + surface must share that single
    // provider's store.
    render(<LiteratureCanvas projectId="project-1" />);
    // The surface mounts. If the
    // `ReactFlowProvider` were missing (or nested
    // in a way that splits the store), xyflow
    // throws "no provider" — the test fails.
    await waitFor(
      () => {
        const el = document.querySelector('.react-flow__viewport');
        if (!el) throw new Error('surface not yet mounted');
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    // The element is in the DOM. The `style`
    // attribute exists (xyflow sets it on every
    // render). A regression that failed to provide
    // the store would have thrown before this DOM
    // element rendered.
    const initialStyle = getViewportStyle();
    expect(initialStyle).toBeTruthy();
    expect(initialStyle).toMatch(/transform/);
  });

  it("parent key handler (Ctrl/Cmd + '=') calls useSurfaceFlow().zoomIn against the surface's shared store", async () => {
    render(<LiteratureCanvas projectId="project-1" />);
    await waitFor(
      () => {
        const el = document.querySelector('.react-flow__viewport');
        if (!el) throw new Error('surface not yet mounted');
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    const before = getViewportStyle();
    expect(before).toBeTruthy();
    // The parent's `useEffect` keydown handler
    // (`LiteratureCanvas.tsx` ~372) listens at the
    // window. We dispatch `=` (the unshifted key on
    // a US layout; the parent handler accepts
    // `'+' | '='`). The handler reads `zoomIn`
    // from `useSurfaceFlow()` and calls it. The
    // mutation must be observable on the surface's
    // `.react-flow__viewport` element (same store).
    // A nested / missing provider would mean
    // `zoomIn` hits a different store and
    // `before === after`.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }),
      );
    });
    // xyflow updates the store synchronously but
    // the re-render + DOM patch is async; wait for
    // the transform style to change.
    await waitFor(
      () => {
        const after = getViewportStyle();
        expect(after).not.toBe(before);
      },
      { timeout: 2000 },
    );
    const after = getViewportStyle();
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });
});
