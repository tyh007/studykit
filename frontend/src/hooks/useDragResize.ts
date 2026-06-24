import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Options for the {@link useDragResize} hook.
 *
 * The hook supports two modes:
 *  - **Pixel mode** (default): `startValue` and the deltas are interpreted in
 *    pixels. Useful for fixed-width/height sidebars and resizable panels.
 *  - **Percent mode** (`asPercentOfContainer: true`): `startValue` is a
 *    percentage of the container's current width/height. The container's
 *    bounding rect is re-read on every move, so resizing the window during
 *    a drag stays consistent.
 */
export interface UseDragResizeOptions {
  /** 'x' = horizontal divider (column-resize). 'y' = vertical (row-resize). */
  axis: 'x' | 'y'
  /** Initial value in pixels (or percent when `asPercentOfContainer` is set). */
  startValue: number
  /** Required when `asPercentOfContainer` is true. */
  containerRef?: React.RefObject<HTMLElement>
  /** Inclusive lower bound applied via `Math.max(min, …)`. */
  min: number
  /** Inclusive upper bound applied via `Math.min(max, …)`. */
  max: number
  /** Called on every pointer move while dragging. */
  onChange: (next: number) => void
  /** Called once on pointerup with the final value. */
  onCommit?: (final: number) => void
  /**
   * If provided, the final value is written to `localStorage[persistKey]`
   * on commit only. Writes are NOT done on every move, so it's safe to drag
   * continuously without thrashing storage.
   */
  persistKey?: string
  /**
   * When true, `startValue` is treated as a percentage of the container's
   * current width/height, and deltas are converted to percent on every move.
   * `containerRef` is required in this mode.
   */
  asPercentOfContainer?: boolean
}

/**
 * Return value of {@link useDragResize}.
 *
 * - `onPointerDown` is attached to the divider element.
 * - `separatorProps` should be spread onto the same element. They give the
 *   divider `role="separator"`, an `aria-orientation`, and live
 *   `aria-valuenow/min/max` so screen readers can announce the new size.
 */
export interface UseDragResizeResult {
  onPointerDown: (e: React.PointerEvent) => void
  value: number
  separatorProps: {
    role: 'separator'
    'aria-orientation': 'horizontal' | 'vertical'
    'aria-valuenow': number
    'aria-valuemin': number
    'aria-valuemax': number
    'aria-label'?: string
  }
}

interface DragState {
  pointer: number
  start: number
}

/**
 * Pointer-event based drag-resize hook that unifies the column/row/sidebar
 * drag-resize handlers that used to live inline in PaperWorkspace,
 * AIChatPanel, SummaryTable, and App.tsx.
 *
 * The hook:
 *  - Handles mouse, touch, and pen via Pointer Events.
 *  - Sets/restores body cursor and `user-select` while dragging.
 *  - Writes to `localStorage` only on commit when `persistKey` is provided
 *    (fixes the 60Hz localStorage thrash that AIChatPanel used to do).
 *  - Cleans up all document listeners and body styles on unmount, even
 *    mid-drag (fixes the dangling-listener leak in the old inline handlers).
 *  - Exposes a11y attributes via `separatorProps` for keyboard / screen-reader
 *    users.
 */
export function useDragResize(opts: UseDragResizeOptions): UseDragResizeResult {
  const {
    axis,
    startValue,
    containerRef,
    min,
    max,
    onChange,
    onCommit,
    persistKey,
    asPercentOfContainer,
  } = opts

  const startRef = useRef<DragState | null>(null)
  // Keep the latest onChange/onCommit/startValue in refs so the pointermove
  // handler always sees fresh values without re-binding the listener (which
  // would require tearing down + re-adding global listeners on every render).
  const onChangeRef = useRef(onChange)
  const onCommitRef = useRef(onCommit)
  const startValueRef = useRef(startValue)
  onChangeRef.current = onChange
  onCommitRef.current = onCommit
  startValueRef.current = startValue

  const [value, setValue] = useState(startValue)

  // Mirror the parent-controlled startValue when it changes (e.g. width
  // restored from localStorage at mount, or a hard reset by the parent).
  useEffect(() => {
    setValue(startValue)
  }, [startValue])

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!startRef.current) return
      const delta =
        axis === 'x' ? e.clientX - startRef.current.pointer : e.clientY - startRef.current.pointer

      let next: number
      if (asPercentOfContainer && containerRef?.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const total = axis === 'x' ? rect.width : rect.height
        if (total <= 0) return
        const pct = startRef.current.start + (delta / total) * 100
        next = Math.max(min, Math.min(max, pct))
      } else {
        next = Math.max(min, Math.min(max, startRef.current.start + delta))
      }

      setValue(next)
      onChangeRef.current(next)
    },
    [axis, asPercentOfContainer, containerRef, min, max],
  )

  const cleanup = useCallback(() => {
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
    document.removeEventListener('pointercancel', handlePointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [handlePointerMove])

  function handlePointerUp() {
    if (!startRef.current) return
    const finalValue = value
    startRef.current = null
    cleanup()
    if (persistKey) {
      try {
        localStorage.setItem(persistKey, String(finalValue))
      } catch {
        // localStorage may be unavailable (private mode, quota); silently ignore
      }
    }
    onCommitRef.current?.(finalValue)
  }

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore secondary buttons (right-click etc.)
      if (e.button !== 0 && e.pointerType === 'mouse') return
      e.preventDefault()
      try {
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      } catch {
        // setPointerCapture can throw if the element is gone; safe to ignore
      }
      startRef.current = {
        pointer: axis === 'x' ? e.clientX : e.clientY,
        start: startValueRef.current,
      }
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
      document.addEventListener('pointercancel', handlePointerUp)
    },
    [axis, handlePointerMove],
  )

  // Cleanup on unmount — even mid-drag. Without this, navigating away from
  // a PaperWorkspace mid-resize would leave `mousemove`/`mouseup` handlers
  // attached to `document`, leaking state into the next screen.
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    onPointerDown,
    value,
    separatorProps: {
      role: 'separator',
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuenow': Math.round(value),
      'aria-valuemin': min,
      'aria-valuemax': max,
    },
  }
}
