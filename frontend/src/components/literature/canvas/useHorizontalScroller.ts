import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseHorizontalScrollerOptions {
  /** When true, the hook will not respond to drag (e.g. for touch devices). */
  disabled?: boolean;
}

export interface UseHorizontalScrollerState {
  /** Live: `true` while the user is dragging. */
  isDragging: boolean;
  /** Live: `true` when there is content overflowing to the left. */
  hasOverflowLeft: boolean;
  /** Live: `true` when there is content overflowing to the right. */
  hasOverflowRight: boolean;
}

export interface UseHorizontalScrollerResult {
  /** Attach to the scroll container. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Reactive state (re-renders the consumer when these change). */
  state: UseHorizontalScrollerState;
}

/**
 * Make a horizontally-scrolling container draggable with a mouse, in
 * addition to the native trackpad/touch behaviour. While the user holds
 * the primary mouse button and drags, the container's `scrollLeft` is
 * updated. The container keeps its native scroll behaviour for
 * trackpads / shift-wheel, so this composes naturally.
 *
 * The returned `state` object is updated in place (mutated) on every
 * transition, so callers that hold onto the reference always see the
 * latest values even if they don't re-render. This is important for
 * tests and for fade indicators that read state inside a timeout.
 */
export function useHorizontalScroller(
  options: UseHorizontalScrollerOptions = {}
): UseHorizontalScrollerResult {
  const { disabled = false } = options;
  const ref = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  // State object that's mutated in place. We use a ref + manual update
  // rather than `useState` so that consumers holding a stale reference
  // still see the latest values.
  const stateRef = useRef<UseHorizontalScrollerState>({
    isDragging: false,
    hasOverflowLeft: false,
    hasOverflowRight: false,
  });
  // Force a re-render trigger so React components using the hook see
  // updates too.
  const [, forceRender] = useState(0);

  const updateState = useCallback((patch: Partial<UseHorizontalScrollerState>) => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof UseHorizontalScrollerState)[]) {
      const next = patch[key];
      if (next === undefined) continue;
      if (stateRef.current[key] !== next) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stateRef.current as any)[key] = next;
        changed = true;
      }
    }
    if (changed) forceRender((value) => value + 1);
  }, []);

  const updateOverflow = useCallback(() => {
    const el = ref.current;
    if (!el) {
      updateState({ hasOverflowLeft: false, hasOverflowRight: false });
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      updateState({ hasOverflowLeft: false, hasOverflowRight: false });
      return;
    }
    updateState({
      hasOverflowLeft: el.scrollLeft > 1,
      hasOverflowRight: el.scrollLeft < max - 1,
    });
  }, [updateState]);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    updateOverflow();

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          (tag === 'BUTTON' && (event.target as HTMLButtonElement).disabled === false)
        ) {
          return;
        }
      }
      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: el.scrollLeft,
        moved: false,
      };
      try {
        el.setPointerCapture(event.pointerId);
      } catch (_err) {
        // ignore — non-fatal
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.startX;
      if (!state.moved && Math.abs(dx) < 4) return;
      if (!state.moved) {
        state.moved = true;
        updateState({ isDragging: true });
      }
      event.preventDefault();
      const target = state.startScrollLeft - dx;
      const max = el.scrollWidth - el.clientWidth;
      el.scrollLeft = Math.max(0, Math.min(max, target));
      updateOverflow();
    };

    const finish = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state || state.pointerId !== event.pointerId) return;
      dragState.current = null;
      if (state.moved) {
        event.preventDefault();
        event.stopPropagation();
        setTimeout(() => updateState({ isDragging: false }), 0);
      } else {
        updateState({ isDragging: false });
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('pointerleave', finish);
    el.addEventListener('scroll', updateOverflow, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateOverflow) : null;
    if (ro) ro.observe(el);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('pointerleave', finish);
      el.removeEventListener('scroll', updateOverflow);
      if (ro) ro.disconnect();
    };
  }, [disabled, updateOverflow, updateState]);

  return {
    ref,
    state: stateRef.current,
  };
}
