/**
 * StudyKit v0.4 — `features/canvas/CognitiveCanvasAdapter`
 *
 * The cognitive canvas's *thin* adapter over the engine's
 * shared `<CanvasSurface>`. WP-06 Round 6 P0-1:
 *
 *   - This file does NOT import the engine's React
 *     Flow primitives directly. The engine's
 *     `CanvasSurface` (`components/literature/canvas/
 *     CanvasSurface.tsx`) is the single React Flow
 *     surface for both the literature canvas and the
 *     cognitive canvas.
 *   - This file does NOT import any CSS file
 *     (engine-owned `literature-canvas.css` is the
 *     single CSS for the canvas; the cognitive
 *     canvas reuses the engine's `canvas-*` classes).
 *   - The cognitive canvas does NOT use the engine's
 *     `CanvasToolbar` (the engine's toolbar has
 *     buttons the cognitive canvas does not support
 *     — PDF / Shape / Group / Text — and shipping
 *     no-op handlers would hide missing
 *     capabilities). The cognitive canvas renders
 *     its own minimal toolbar using the engine's
 *     `canvas-toolbar` / `canvas-toolbar-btn`
 *     classes, with only the buttons it actually
 *     supports: view-mode toggle, undo, Ask AI.
 *   - The adapter's only job is to *map* a
 *     `CanvasViewSnapshot` to the engine's
 *     `CanvasFlowNode` / `CanvasFlowEdge` shape, and
 *     forward xyflow events back to the cognitive
 *     canvas's use cases.
 *   - Errors surface through a visible `aria-live`
 *     region (`useState`-backed); the previous
 *     `.catch(() => undefined)` swallows are gone.
 *
 * The cognitive canvas's keyboard state machine
 * (Enter / n / c / p / Tab / Escape / Backspace) is
 * `CanvasSurface`'s `onKeyDown`. The handler reads
 * `pendingConnect` / `selectedRef` from React state,
 * calls the right use case, and surfaces failures
 * through the `error` state.
 *
 * Delete (`Backspace` / `Delete`) now calls the new
 * `removePlacement` use case (a placement id is not a
 * relation id; the previous `deleteRelation({ relationId:
 * placement.id })` was a no-op + silent swallow).
 *
 * The upgrade popover is an inline `<div role="menu">`
 * overlay — not a `window.prompt`, not a second toolbar
 * file. The popover is a local subcomponent of this
 * file (it depends on the adapter's local state) and
 * does NOT import any xyflow primitive.
 */

import React from 'react';

import TextNode from '../../components/literature/canvas/TextNode';
import NoteNode from '../../components/literature/canvas/NoteNode';
import QuestionNode from '../../components/literature/canvas/QuestionNode';
import {
  CanvasSurface,
  useSurfaceControls,
  useSurfaceFlow,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node as RFNode,
  type Edge as RFEdge,
} from '../../components/literature/canvas/CanvasSurface';
import CognitiveCard from './CognitiveCard';
import {
  snapshotToFlowGraph,
  type CognitiveAdapterActions,
} from './canvasMappings';
import { buildCanvasActionArgs } from './canvasActionArgs';
import {
  refKey,
  sameRef,
  type CanvasObjectRef,
  type CanvasViewSnapshot,
  type RelationKind,
} from '../../domain/canvas';
import type { CanvasUseCases } from '../../application/canvas/canvasGateway';
import { UPGRADEABLE_KINDS } from '../../repositories/shimStudyKitRepository';
import type { KnowledgeObjectKind } from '../../domain/repository';
import { openCapsule } from '../ai/ui/openCapsule';

// ---------------------------------------------------------------------------
// Node-type registry
// ---------------------------------------------------------------------------

const nodeTypes = {
  text: TextNode,
  note: NoteNode,
  question: QuestionNode,
  paper: CognitiveCard,
  group: CognitiveCard,
  shape: CognitiveCard,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CognitiveCanvasAdapterProps {
  readonly viewId: string;
  readonly useCases: CanvasUseCases;
  readonly subscribe: (listener: (s: CanvasViewSnapshot) => void) => () => void;
  readonly getSnapshot: () => CanvasViewSnapshot | null;
  /** Initial refs to materialise on first open. */
  readonly initialRefs?: readonly CanvasObjectRef[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CognitiveCanvasAdapter(
  props: CognitiveCanvasAdapterProps,
): React.ReactElement {
  const { viewId, useCases, subscribe, getSnapshot, initialRefs } = props;
  const [snapshot, setSnapshot] = React.useState<CanvasViewSnapshot | null>(() =>
    getSnapshot(),
  );
  // The visible error state. All async user actions
  // (Enter / p / Backspace / drag / connect) flow
  // through this; `.catch(() => undefined)` is gone.
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    return subscribe((s) => setSnapshot(s));
  }, [subscribe, viewId]);

  // WP-11R2: we need the xyflow screenToFlowPosition
  // to translate the user's double-click / paste
  // pixel coordinates into canvas (flow) coordinates.
  // `useSurfaceFlow` is the *engine* hook (not the
  // toolbar-only `useSurfaceControls`); it is safe to
  // call here because the parent is always inside a
  // `<CanvasSurfaceProvider>`.
  const flow = useSurfaceFlow();
  const screenToFlow = flow?.screenToFlowPosition;

  // WP-11R2: an internal "Add free node" helper that
  // every entry path goes through — keyboard Enter/n,
  // the toolbar "Add idea" button, double-click on
  // the surface, and paste. The same helper is the
  // *single* call site for `addFreeNode` so each
  // path produces one canonical node.
  const handleAddFreeNode = React.useCallback(
    (input: { body?: string; clientX?: number; clientY?: number }): void => {
      let position: { x: number; y: number } | undefined;
      if (
        input.clientX !== undefined &&
        input.clientY !== undefined &&
        typeof screenToFlow === 'function'
      ) {
        const flowPos = screenToFlow({
          x: input.clientX,
          y: input.clientY,
        });
        position = { x: flowPos.x, y: flowPos.y };
      }
      void useCases
        .addFreeNode({
          viewId,
          container: containerForView(viewId),
          body: input.body ?? '',
          ...(position ? { position } : {}),
        })
        .then((r) => {
          if (!r.ok) {
            setError(`addFreeNode failed: ${r.error.code}`);
            return;
          }
          // WP-11R2: the new free node becomes the
          // selected ref so the user can immediately
          // type. The first node creation also ends
          // the empty state.
          setSelectedRef({ kind: 'free', id: r.value.freeNode.id });
        });
    },
    [useCases, viewId, screenToFlow],
  );

  // Keyboard state machine.
  const [pendingConnect, setPendingConnect] = React.useState<CanvasObjectRef | null>(null);
  const [selectedRef, setSelectedRef] = React.useState<CanvasObjectRef | null>(null);
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);

  const findRef = React.useCallback(
    (nodeId: string): CanvasObjectRef | null => {
      const s = getSnapshot();
      if (!s) return null;
      const placement = s.placements.find((p) => p.id === nodeId);
      if (placement) return placement.ref;
      // `nodeId` may be the bare ref (e.g. `free:abc`).
      for (const p of s.placements) {
        if (refKey(p.ref) === nodeId) return p.ref;
      }
      return null;
    },
    [getSnapshot, viewId],
  );

  const actions = React.useMemo<CognitiveAdapterActions>(
    () => ({
      onNodeContentChange: (nodeId, text) => {
        const s = getSnapshot();
        if (!s) return;
        const placement = s.placements.find((p) => p.id === nodeId);
        if (!placement) return;
        if (placement.ref.kind === 'free') {
          void useCases
            .updateFreeNode({ viewId, freeRef: placement.ref, body: text })
            .then((r) => {
              if (!r.ok) setError(`updateFreeNode failed: ${r.error.code}`);
            });
        }
      },
      onNodeResize: (nodeId, width, height) => {
        const s = getSnapshot();
        if (!s) return;
        const placement = s.placements.find((p) => p.id === nodeId);
        if (!placement) return;
        void useCases
          .movePlacement({ viewId, ref: placement.ref, patch: { width, height } })
          .then((r) => {
            if (!r.ok) setError(`movePlacement failed: ${r.error.code}`);
          });
      },
      onNodeDelete: (nodeId) => {
        // The cognitive canvas's `Backspace` / `Delete`
        // key sends a nodeId that may be a placement
        // id (the engine maps placements to nodes
        // 1:1). We call the new `removePlacement` use
        // case — a placement id is *not* a relation id.
        void useCases
          .removePlacement({ viewId, placementId: nodeId })
          .then((r) => {
            if (!r.ok) setError(`removePlacement failed: ${r.error.code}`);
          });
      },
      onEdgeDelete: (edgeId) => {
        void useCases
          .deleteRelation({ viewId, relationId: edgeId })
          .then((r) => {
            if (!r.ok) setError(`deleteRelation failed: ${r.error.code}`);
          });
      },
      onConnect: (fromRef, toRef) => {
        void useCases
          .connectDraft({ viewId, from: fromRef, to: toRef, kind: 'untyped' as RelationKind, authorType: 'user' })
          .then((r) => {
            if (!r.ok) setError(`connectDraft failed: ${r.error.code}`);
          });
      },
      onViewportChange: (viewport) => {
        void useCases
          .setViewport({ viewId, viewport })
          .then((r) => {
            if (!r.ok) setError(`setViewport failed: ${r.error.code}`);
          });
      },
    }),
    [viewId, useCases, getSnapshot],
  );

  const { nodes, edges } = React.useMemo(
    () => (snapshot ? snapshotToFlowGraph(snapshot, actions) : { nodes: [], edges: [] }),
    [snapshot, actions],
  );

  // Engines `onNodesChange` → forward to `movePlacement`
  // when the user finished a drag. xyflow fires
  // intermediate `position` changes during the drag;
  // we forward only the *final* one so the canvas does
  // not spam Dexie on every pixel.
  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      // Forward the *finished* drag to the use case.
      // The engine's `CanvasSurface` handles
      // intermediate drag positions; the adapter
      // only translates the *final* one. The
      // adapter does not import the engine's React
      // Flow types.
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          const ref = findRef(change.id);
          if (!ref) continue;
          void useCases
            .movePlacement({
              viewId,
              ref,
              patch: { x: change.position.x, y: change.position.y },
            })
            .then((r) => {
              if (!r.ok) setError(`movePlacement failed: ${r.error.code}`);
            });
        }
      }
    },
    [viewId, useCases, findRef],
  );

  // Engines `onEdgesChange` → forward removals to
  // `deleteRelation`. We do not forward selection
  // changes; the cognitive canvas's selection state
  // is local.
  const onEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          void useCases
            .deleteRelation({ viewId, relationId: change.id })
            .then((r) => {
              if (!r.ok) setError(`deleteRelation failed: ${r.error.code}`);
            });
        }
      }
    },
    [viewId, useCases],
  );

  // Engines `onConnect` (xyflow): the user dragged a
  // handle from one node to another. We forward to
  // `connectDraft`. (The previous `sameRef` check
  // was a dead branch — `xyflow` does not allow
  // connecting a node to itself — but we keep the
  // use case's `invalid-input` check as a
  // defence-in-depth.)
  const onConnect = React.useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const from = findRef(conn.source);
      const to = findRef(conn.target);
      if (!from || !to || sameRef(from, to)) return;
      void useCases
        .connectDraft({ viewId, from, to, kind: 'untyped' as RelationKind, authorType: 'user' })
        .then((r) => {
          if (!r.ok) setError(`connectDraft failed: ${r.error.code}`);
        });
    },
    [viewId, useCases, findRef],
  );

  // Engines `onSelectionChange` (xyflow): the user
  // selected one or more nodes. We track the *first*
  // one as the cognitive canvas's selected ref. We do
  // NOT clear the selection on an empty event (the
  // previous implementation did, which clobbered the
  // keyboard-driven `selectedRef` set by Enter and
  // made the upgrade popover unreachable).
  const onSelectionChange = React.useCallback(
    (selection: { nodes: readonly RFNode[]; edges: readonly RFEdge[] }) => {
      const first = selection.nodes[0];
      if (!first) return;
      const ref = findRef(first.id);
      if (ref) setSelectedRef(ref);
    },
    [findRef],
  );

  const onSurfaceKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Connect-mode Enter is the *first* branch — the
      // previous implementation had create-Enter
      // shadowing accept-Enter, which made Accept
      // unreachable. The fix is ordering: connect
      // first, then create, then the rest.
      if (pendingConnect && e.key === 'Enter') {
        e.preventDefault();
        if (selectedRef && !sameRef(pendingConnect, selectedRef)) {
          void useCases
            .connectDraft({
              viewId,
              from: pendingConnect,
              to: selectedRef,
              kind: 'untyped' as RelationKind,
              authorType: 'user',
            })
            .then((r) => {
              if (!r.ok) setError(`connectDraft failed: ${r.error.code}`);
              setPendingConnect(null);
              setSelectedRef(null);
            });
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPendingConnect(null);
        setSelectedRef(null);
        setUpgradeOpen(false);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (selectedRef) {
          // The selected ref is the *ref*, not a
          // placement id. We resolve it back to the
          // placement and call the real
          // `removePlacement`. The cognitive canvas's
          // relations are deleted via the relation
          // selection (xyflow edge selection), not
          // the Backspace key.
          const s = getSnapshot();
          if (!s) return;
          const placement = s.placements.find((p) => sameRef(p.ref, selectedRef));
          if (!placement) return;
          if (placement.ref.kind === 'free') {
            void useCases
              .removePlacement({ viewId, placementId: placement.id })
              .then((r) => {
                if (!r.ok) setError(`removePlacement failed: ${r.error.code}`);
                setSelectedRef(null);
              });
          }
          // Canonical nodes: the cognitive canvas
          // does not own them. Collapse them instead
          // of deleting (the Evidence Workspace
          // remains the canonical source).
          else {
            void useCases
              .movePlacement({
                viewId,
                ref: placement.ref,
                patch: { collapsed: true },
              })
              .then((r) => {
                if (!r.ok) setError(`movePlacement failed: ${r.error.code}`);
              });
          }
        }
        return;
      }
      if (e.key === 'Enter' || e.key === 'n') {
        e.preventDefault();
        // WP-11R2: route through the same `handleAddFreeNode`
        // helper the toolbar / dbl-click / paste use, so
        // there is exactly one path to a canonical free node.
        handleAddFreeNode({ body: '' });
        return;
      }
      if (e.key === 'c' && selectedRef) {
        e.preventDefault();
        setPendingConnect(selectedRef);
        return;
      }
      if (e.key === 'o') {
        e.preventDefault();
        const s = getSnapshot();
        if (!s) return;
        const next = s.view.mode === 'spatial' ? 'outline' : 'spatial';
        void useCases
          .setViewMode({ viewId, mode: next })
          .then((r) => {
            if (!r.ok) setError(`setViewMode failed: ${r.error.code}`);
          });
        return;
      }
      if (e.key === 'u') {
        e.preventDefault();
        void useCases
          .undo({ viewId })
          .then((r) => {
            if (!r.ok) setError(`undo failed: ${r.error.code}`);
          });
        return;
      }
      if (e.key === 'p' && selectedRef) {
        e.preventDefault();
        setUpgradeOpen(true);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = getSnapshot();
        if (!s || s.placements.length === 0) return;
        const ids = s.placements.map((p) => refKey(p.ref));
        const cur = selectedRef ? refKey(selectedRef) : null;
        const idx = cur ? ids.indexOf(cur) : -1;
        const nextIdx = e.shiftKey
          ? (idx - 1 + ids.length) % ids.length
          : (idx + 1) % ids.length;
        setSelectedRef(s.placements[nextIdx].ref);
        return;
      }
    },
    [pendingConnect, selectedRef, useCases, viewId, getSnapshot, handleAddFreeNode],
  );

  if (!snapshot || snapshot.view.id === '__empty__') {
    return (
      <div
        className="literature-canvas"
        role="status"
        aria-live="polite"
        data-testid="cognitive-canvas-loading"
      >
        Loading canvas…
      </div>
    );
  }

  const preview = snapshot.relations.filter((r) => r.status === 'preview');
  const accepted = snapshot.relations.filter((r) => r.status === 'accepted');
  // P0-4: build the typed args for the 3 canvas AI
  // actions before opening the IntentCapsule. The
  // `buildCanvasActionArgs` builder is a pure
  // function of the snapshot; the result is the
  // `precomputedActionArgs` map the
  // `IntentCapsule.buildArgsForAction` reads first.
  // We derive `selectedRefIds` *inside* the same
  // memo so the dependency array stays stable across
  // renders (the `selectedRef` / `placements` refs
  // are stable as long as the snapshot hasn't
  // changed).
  const builtActionArgs = React.useMemo(() => {
    const selectedRefIds: readonly string[] = selectedRef
      ? [refKey(selectedRef)]
      : snapshot.placements.map((p) => refKey(p.ref));
    return buildCanvasActionArgs({
      surface: 'intent-capsule',
      viewId,
      snapshot,
      selectedRefIds,
    });
  }, [viewId, snapshot, selectedRef]);
  return (
    <div
        className="literature-canvas"
        role="application"
        aria-label={`Cognitive canvas: ${snapshot.view.title}`}
        data-testid="cognitive-canvas-flow"
        onKeyDown={onSurfaceKeyDown}
        onPaste={(e) => {
          // WP-11R2: pasting plain text creates one
          // free node with the pasted body. URLs and
          // known object refs fall through to the
          // engine's default paste handler; the audit
          // verdict is "paste creates a free node
          // unless the surface already understands
          // the drop". This is the same path the
          // toolbar / dbl-click use — one canonical
          // node per paste.
          const text = e.clipboardData.getData('text/plain').trim();
          if (text.length === 0) return;
          e.preventDefault();
          handleAddFreeNode({ body: text });
        }}
        tabIndex={0}
      >
        <CanvasSurface
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onKeyDown={onSurfaceKeyDown}
          onDoubleClick={(e) => {
            // WP-11R2: background double-click creates
            // one free node at the click position.
            // xyflow swallows the event on a node
            // handle, so the handler only fires on
            // background / pane double-clicks.
            handleAddFreeNode({ clientX: e.clientX, clientY: e.clientY });
          }}
          className="canvas-surface"
          ariaLabel={`Cognitive canvas: ${snapshot.view.title}`}
          role="application"
          tabIndex={0}
          toolbar={<CognitiveToolbar
            viewId={viewId}
            useCases={useCases}
            getSnapshot={getSnapshot}
            selectedRef={selectedRef}
            onAddIdea={() => handleAddFreeNode({ body: '' })}
            onConnectorMode={() => {
              const s = getSnapshot();
              if (!s || !selectedRef) return;
              setPendingConnect(selectedRef);
            }}
            onToggleViewMode={() => {
              const next = snapshot.view.mode === 'spatial' ? 'outline' : 'spatial';
              void useCases
                .setViewMode({ viewId, mode: next })
                .then((r) => {
                  if (!r.ok) setError(`setViewMode failed: ${r.error.code}`);
                });
            }}
            onUndo={() => {
              void useCases
                .undo({ viewId })
                .then((r) => {
                  if (!r.ok) setError(`undo failed: ${r.error.code}`);
                });
            }}
            onAskAI={() => {
              // P0-4: open the shared Intent Capsule
              // with the *current* selection. The
              // 3 `canvas-suggest-*` actions receive
              // typed args from
              // `buildCanvasActionArgs`; the
              // `IntentCapsule.buildArgsForAction`
              // reads them first. We start at
              // `current-view` scope so the
              // canvas-suggest-* chips are enabled
              // (their `requiredScope: 'current-view'`
              // — the default `selection` would
              // disable them).
              const projectId = viewId.startsWith('canvas-') ? viewId.slice('canvas-'.length) : 'local';
              // Recompute the same derivation the
              // `useMemo` uses so the `selectedObjectIds`
              // we send match the args the builder
              // produced. The builder is the single
              // source of truth.
              const askSelectedIds: readonly string[] = selectedRef
                ? [refKey(selectedRef)]
                : snapshot.placements.map((p) => refKey(p.ref));
              openCapsule({
                surface: 'intent-capsule',
                selectedText: null,
                selectedObjectIds: askSelectedIds,
                precomputedActionArgs: builtActionArgs.args,
                initialScope: 'current-view',
                container: { workspaceId: null, mode: 'research', kind: 'project', id: projectId },
              });
            }}
          />}
          overlay={
            <>
              {error ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  data-testid="cognitive-canvas-error"
                  className="canvas-status"
                >
                  {error}
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="Dismiss error"
                    className="canvas-toolbar-btn"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              <div className="canvas-status" role="status" aria-live="polite">
                {accepted.length} accepted · {preview.length} preview · {nodes.length} nodes
              </div>
              {pendingConnect ? (
                <div
                  className="canvas-connector-hint"
                  role="status"
                  aria-live="polite"
                >
                  Connect mode: select a target and press <kbd>Enter</kbd> to preview.{' '}
                  <button
                    type="button"
                    onClick={() => setPendingConnect(null)}
                    className="canvas-toolbar-btn"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              {/*
                WP-11R2: the empty-canvas hint. The
                audit Step 10 verdict was that the
                empty canvas had no discoverable
                start. The hint is rendered only when
                there are no placements yet; the
                moment the first node is created
                (via any of the three entry paths)
                the hint disappears because
                `snapshot.placements.length > 0`.
              */}
              {snapshot.placements.length === 0 ? (
                <div
                  className="canvas-empty-hint"
                  role="status"
                  aria-live="polite"
                  data-testid="cognitive-canvas-empty-hint"
                >
                  <strong>Double-click anywhere or add your first idea.</strong>
                  <span>
                    You can also press <kbd>Enter</kbd>, paste text, or click <kbd>+ Add idea</kbd>.
                  </span>
                </div>
              ) : null}
              {upgradeOpen && selectedRef && selectedRef.kind === 'free' ? (
                <UpgradePopover
                  kinds={UPGRADEABLE_KINDS}
                  onPick={(k) => {
                    setUpgradeOpen(false);
                    void useCases
                      .upgradeNode({ viewId, freeRef: selectedRef, targetKind: k as KnowledgeObjectKind })
                      .then((r) => {
                        if (!r.ok) setError(`upgradeNode failed: ${r.error.code}`);
                      });
                  }}
                  onCancel={() => setUpgradeOpen(false)}
                />
              ) : null}
            </>
          }
        />
        {preview.length > 0 ? (
          <ul
            role="region"
            aria-label="Preview relations"
            data-testid="cognitive-canvas-preview-tray"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              listStyle: 'none',
              padding: '0.5rem 1rem',
              margin: 0,
              background: 'var(--canvas-tray-bg, rgba(0,0,0,0.02))',
              borderTop: '1px solid var(--canvas-border, rgba(0,0,0,0.1))',
            }}
          >
            {preview.map((r) => (
              <li
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span className="canvas-status" style={{ minWidth: 80 }}>{r.kind}</span>
                <span style={{ flex: 1, opacity: 0.8 }}>
                  {r.from.id} → {r.to.id}
                </span>
                <button
                  type="button"
                  className="canvas-toolbar-btn"
                  onClick={() => {
                    void useCases
                      .acceptRelation({ viewId, relationId: r.id })
                      .then((res) => {
                        if (!res.ok) setError(`acceptRelation failed: ${res.error.code}`);
                      });
                  }}
                  aria-label={`Accept relation ${r.id}`}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="canvas-toolbar-btn"
                  onClick={() => {
                    void useCases
                      .rejectRelation({ viewId, relationId: r.id })
                      .then((res) => {
                        if (!res.ok) setError(`rejectRelation failed: ${res.error.code}`);
                      });
                  }}
                  aria-label={`Reject relation ${r.id}`}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="canvas-toolbar-btn"
                  onClick={() => {
                    void useCases
                      .deleteRelation({ viewId, relationId: r.id })
                      .then((res) => {
                        if (!res.ok) setError(`deleteRelation failed: ${res.error.code}`);
                      });
                  }}
                  aria-label={`Delete relation ${r.id}`}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
  );
}

// ---------------------------------------------------------------------------
// Cognitive toolbar (engine classes, no no-op buttons)
// ---------------------------------------------------------------------------

interface CognitiveToolbarProps {
  readonly viewId: string;
  readonly useCases: CanvasUseCases;
  readonly getSnapshot: () => CanvasViewSnapshot | null;
  readonly selectedRef: CanvasObjectRef | null;
  readonly onAddIdea: () => void;
  readonly onConnectorMode: () => void;
  readonly onToggleViewMode: () => void;
  readonly onUndo: () => void;
  readonly onAskAI: () => void;
}

function CognitiveToolbar(props: CognitiveToolbarProps): React.ReactElement {
  const { selectedRef, onAddIdea, onConnectorMode, onToggleViewMode, onUndo, onAskAI } = props;
  const surface = useSurfaceControls();
  // Snapshot-driven view-mode label.
  const snap = props.getSnapshot();
  const mode = snap?.view.mode ?? 'spatial';
  return (
    <div className="canvas-topbar">
      <div className="canvas-topbar-tools">
        {/*
          WP-11R2: the Add idea button is the
          *primary* empty-state action. The audit
          Step 10 verdict was that the toolbar had
          no obvious "start" affordance; the empty
          canvas had no clue. Add idea calls the
          same `handleAddFreeNode` the dbl-click /
          paste paths use — exactly one
          `addFreeNode` per click.
        */}
        <button
          type="button"
          className="canvas-toolbar-btn canvas-toolbar-btn--primary"
          onClick={onAddIdea}
          aria-label="Add a free idea node"
          title="Add an idea (or press Enter / double-click the background / paste text)"
          data-testid="cognitive-canvas-add-idea"
        >
          + Add idea
        </button>
        {/*
          WP-11R2: Connector is *hidden* (not just
          disabled) when there is no selection. The
          audit Step 10 verdict was that disabled
          toolbar buttons attract attention they
          cannot honour. We render the button only
          when `selectedRef` is set so the empty
          state stays clean.
        */}
        {selectedRef ? (
          <button
            type="button"
            className="canvas-toolbar-btn"
            onClick={onConnectorMode}
            title="Start a connect from the selected ref"
            aria-label="Connector tool"
            data-testid="cognitive-canvas-connector"
          >
            Connector
          </button>
        ) : null}
        <button
          type="button"
          className="canvas-toolbar-btn"
          onClick={onToggleViewMode}
          aria-label="Toggle view mode"
          title="Toggle between spatial and outline view"
          data-testid="cognitive-canvas-toggle-mode"
        >
          {mode === 'spatial' ? 'Outline' : 'Canvas'}
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn"
          onClick={onUndo}
          aria-label="Undo last change"
          title="Undo last change"
          data-testid="cognitive-canvas-undo"
        >
          Undo
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn"
          onClick={() => surface.fitView()}
          aria-label="Fit to content"
          title="Fit to content"
          data-testid="cognitive-canvas-fit-view"
        >
          Fit
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn"
          onClick={onAskAI}
          aria-label="Open intent capsule with current selection"
          title="Ask the AI assistant about the current selection"
          data-testid="cognitive-canvas-open-capsule"
        >
          Ask AI
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upgrade popover (inline; no second toolbar file)
// ---------------------------------------------------------------------------

interface UpgradePopoverProps {
  readonly kinds: ReadonlyArray<KnowledgeObjectKind>;
  readonly onPick: (k: KnowledgeObjectKind) => void;
  readonly onCancel: () => void;
}

function UpgradePopover(props: UpgradePopoverProps): React.ReactElement {
  return (
    <div
      role="presentation"
      onClick={props.onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="canvas-toolbar"
        role="menu"
        aria-label="Promote free node to a typed object"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--canvas-bg, white)',
          padding: '1rem',
          borderRadius: 8,
          minWidth: 280,
        }}
      >
        <h3 style={{ margin: '0 0 0.5rem' }}>Promote to</h3>
        <p style={{ margin: '0 0 0.5rem' }}>
          Upgrade this free node into a typed object. Kinds without a real
          Dexie write path are not listed.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {props.kinds.map((k) => (
            <li key={k}>
              <button
                type="button"
                role="menuitem"
                className="canvas-toolbar-btn"
                onClick={() => props.onPick(k)}
                aria-label={`Promote to ${k}`}
                style={{ width: '100%', textAlign: 'left' }}
              >
                {k}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="canvas-toolbar-btn"
          onClick={props.onCancel}
          aria-label="Cancel upgrade"
          style={{ marginTop: '0.5rem' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containerForView(viewId: string): import('../../domain/workspace').ContainerRef {
  const projectId = viewId.startsWith('canvas-') ? viewId.slice('canvas-'.length) : 'local';
  return {
    workspaceId: null,
    mode: 'research',
    kind: 'project',
    id: projectId,
  };
}
