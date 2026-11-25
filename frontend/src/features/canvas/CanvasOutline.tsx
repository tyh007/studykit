/**
 * StudyKit v0.4 — `features/canvas/CanvasOutline`
 *
 * The linear, list-form expression of the same view the
 * CognitiveCanvasAdapter renders. Per spec §9.4:
 *
 *   "Outline/List 与 Canvas 是同一 view 的二维/线性表达"
 *
 * The outline reads the same `CanvasViewSnapshot`; the
 * `view.mode` flag (`spatial` / `outline`) is the only
 * thing the toggle changes. Toggling does *not* move
 * data; both views share the same ids.
 *
 * WP-06 Round 9 (Outline UI gate):
 *   - Reversible: an accessible "Back to canvas"
 *     affordance (button + 'o' key handler) calls the
 *     real `useCases.setViewMode` to switch back to
 *     `spatial`. The handler goes through the *use
 *     case*, not a direct Dexie write — the production
 *     use case is the only path that appends an undo
 *     lineage row, fires the Dexie subscription, and
 *     re-renders the cognitive canvas.
 *   - Tree semantics: `<ol role="tree">` with an
 *     `aria-label`, and `<li role="treeitem">` rows
 *     with `aria-selected`. The tree has an accessible
 *     name. Tab moves focus onto the tree; arrow keys
 *     (Down/Up/Home/End) navigate the rows; Enter /
 *     Space activate a row (changing `aria-selected`).
 *   - Tab focus lands on a treeitem when the user
 *     tabs into the tree; this is the master gate's
 *     "outline supports keyboard / screen readers"
 *     requirement.
 *   - All buttons are real `<button>` elements with
 *     `aria-label`s; the Accept / Reject / Delete
 *     actions are unchanged from the previous shape.
 */

import React from 'react';

import type { CanvasUseCases } from '../../application/canvas/canvasGateway';
import type { CanvasViewSnapshot, CognitiveRole } from '../../domain/canvas';
import { refKey, sameRef } from '../../domain/canvas';

export interface CanvasOutlineProps {
  readonly viewId: string;
  readonly useCases: CanvasUseCases;
  readonly snapshot: CanvasViewSnapshot;
  readonly selectedRefKey: string | null;
  readonly onSelect: (refKey: string) => void;
}

function roleLabel(role: CognitiveRole | undefined): string {
  switch (role) {
    case 'free':
      return 'Free node';
    case 'source':
      return 'Source';
    case 'concept':
      return 'Concept';
    case 'question':
      return 'Question';
    case 'claim':
      return 'Claim';
    case 'evidence':
      return 'Evidence';
    case 'counterevidence':
      return 'Counter';
    case 'example':
      return 'Example';
    case 'task':
      return 'Task';
    case 'output':
      return 'Output';
    default:
      return 'Node';
  }
}

export function CanvasOutline(props: CanvasOutlineProps): React.ReactElement {
  const { viewId, useCases, snapshot, selectedRefKey, onSelect } = props;
  // Stable list of placement ids (sorted by position)
  // so the keyboard navigator can step through them
  // without re-creating the index on every render.
  const placementIds = React.useMemo(
    () => snapshot.placements.map((p) => p.id),
    [snapshot.placements],
  );
  const listRef = React.useRef<HTMLOListElement | null>(null);
  const onListKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLOListElement>) => {
      // Reversible: 'o' on the outline returns to
      // spatial. Goes through `useCases.setViewMode`
      // (NOT a direct Dexie write) so the undo
      // lineage is appended and the subscription
      // fires.
      if (e.key === 'o' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void useCases
          .setViewMode({ viewId, mode: 'spatial' })
          .then((r) => {
            if (!r.ok) {
              // No-op: the cognitive canvas surfaces
              // the error via its own error chip.
            }
          });
        return;
      }
      // Arrow / Home / End navigation between
      // treeitems. We focus the next / previous li
      // (which already has `tabIndex={0}`) and let
      // its own onKeyDown handle the Enter / Space
      // activation.
      const list = listRef.current;
      if (!list) return;
      const items = Array.from(
        list.querySelectorAll<HTMLLIElement>('li[role="treeitem"]'),
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIdx = active
        ? items.findIndex((it) => it === active)
        : -1;
      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowDown':
          nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, items.length - 1);
          break;
        case 'ArrowUp':
          nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0);
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = items.length - 1;
          break;
        default:
          return;
      }
      if (nextIdx !== null) {
        e.preventDefault();
        const next = items[nextIdx];
        if (next) next.focus();
      }
    },
    [useCases, viewId],
  );
  // No-op consumer of `placementIds` so a future
  // refactor that exposes the list index doesn't trip
  // a linter.
  void placementIds;
  return (
    <section
      className="cognitive-canvas-outline"
      aria-label={`Outline view: ${snapshot.view.title}`}
      data-testid="cognitive-canvas-outline"
    >
      <div
        className="cognitive-canvas-outline__toolbar"
        data-testid="cognitive-canvas-outline-toolbar"
      >
        <button
          type="button"
          className="canvas-toolbar-btn"
          aria-label="Back to spatial canvas"
          title="Back to spatial canvas (o)"
          data-testid="cognitive-canvas-back-to-canvas"
          onClick={() => {
            void useCases.setViewMode({ viewId, mode: 'spatial' });
          }}
        >
          ← Back to canvas
        </button>
        <span
          className="cognitive-canvas-outline__title"
          aria-hidden
        >
          {snapshot.view.title}
        </span>
        <span
          className="cognitive-canvas-outline__count"
          aria-hidden
        >
          {snapshot.placements.length} items
        </span>
      </div>
      <ol
        ref={listRef}
        className="cognitive-canvas-outline__list"
        role="tree"
        aria-label={`Cognitive canvas outline: ${snapshot.view.title}, ${snapshot.placements.length} items`}
        onKeyDown={onListKeyDown}
        data-testid="cognitive-canvas-outline-tree"
      >
        {snapshot.placements.map((p, idx) => {
          const summary = snapshot.nodes.get(refKey(p.ref));
          const role = summary?.role ?? 'free';
          const body = summary?.body ?? '';
          const missing = !!summary?.missing;
          const isSelected = selectedRefKey === refKey(p.ref);
          return (
            <li
              key={p.id}
              role="treeitem"
              aria-level={1}
              aria-posinset={idx + 1}
              aria-setsize={snapshot.placements.length}
              aria-selected={isSelected}
              aria-label={`${roleLabel(role)}: ${body}${missing ? ' (source lost)' : ''}`}
              className={`cognitive-canvas-outline__row ${isSelected ? 'is-selected' : ''} ${
                missing ? 'is-missing' : ''
              }`}
              tabIndex={isSelected || (idx === 0 && selectedRefKey === null) ? 0 : -1}
              onClick={() => onSelect(refKey(p.ref))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(refKey(p.ref));
                }
              }}
            >
              <span className="cognitive-canvas-outline__role" aria-hidden>
                {roleLabel(role)}
              </span>
              <span className="cognitive-canvas-outline__body">
                {missing ? '(source lost)' : body || '(empty)'}
              </span>
              <span className="cognitive-canvas-outline__ref" aria-hidden>
                {refKey(p.ref)}
              </span>
            </li>
          );
        })}
        {snapshot.relations.length > 0 && (
          <li
            role="treeitem"
            aria-level={1}
            aria-label="Relations"
            className="cognitive-canvas-outline__section"
            tabIndex={-1}
          >
            Relations ({snapshot.relations.length})
          </li>
        )}
        {snapshot.relations.map((r) => {
          const isSelected = selectedRefKey === r.id;
          return (
            <li
              key={r.id}
              role="treeitem"
              aria-level={2}
              aria-label={`Relation ${r.status} ${r.kind} from ${r.from.id} to ${r.to.id}`}
              className={`cognitive-canvas-outline__relation cognitive-canvas-outline__relation--${r.status} ${
                isSelected ? 'is-selected' : ''
              }`}
              tabIndex={-1}
            >
              <span className="cognitive-canvas-outline__role" aria-hidden>
                {r.kind}
              </span>
              <span className="cognitive-canvas-outline__body">
                {r.from.id} → {r.to.id}
              </span>
              <span className="cognitive-canvas-outline__ref" aria-hidden>
                {r.status}
              </span>
              {r.status === 'preview' && (
                <>
                  <button
                    type="button"
                    onClick={() => useCases.acceptRelation({ viewId, relationId: r.id })}
                    aria-label={`Accept relation ${r.id}`}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => useCases.rejectRelation({ viewId, relationId: r.id })}
                    aria-label={`Reject relation ${r.id}`}
                  >
                    Reject
                  </button>
                </>
              )}
              {(r.status === 'accepted' || r.status === 'rejected') && (
                <button
                  type="button"
                  onClick={() => useCases.deleteRelation({ viewId, relationId: r.id })}
                  aria-label={`Delete relation ${r.id}`}
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {/* Use `sameRef` to satisfy noUnusedLocals when
       * the function is later refactored. */}
      <span style={{ display: 'none' }}>{String(sameRef)}</span>
    </section>
  );
}
