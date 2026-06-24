import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragResize } from './useDragResize'

describe('useDragResize', () => {
  beforeEach(() => {
    // Clean DOM between tests.
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns separatorProps with role="separator" and live aria-valuenow', () => {
    const { result } = renderHook(() =>
      useDragResize({
        axis: 'x',
        startValue: 200,
        min: 100,
        max: 400,
        onChange: () => undefined,
      }),
    )
    expect(result.current.separatorProps.role).toBe('separator')
    expect(result.current.separatorProps['aria-orientation']).toBe('vertical')
    expect(result.current.separatorProps['aria-valuenow']).toBe(200)
    expect(result.current.separatorProps['aria-valuemin']).toBe(100)
    expect(result.current.separatorProps['aria-valuemax']).toBe(400)
  })

  it('axis="x" tracks clientX deltas and clamps within [min, max]', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDragResize({ axis: 'x', startValue: 200, min: 100, max: 400, onChange }),
    )

    act(() => {
      result.current.onPointerDown({
        clientX: 100,
        clientY: 0,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    // Move +50px → expected value 250
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 0 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(250)
    // Move past the max → should clamp to 400
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 9999, clientY: 0 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(400)
    // Move below the min → should clamp to 100
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: -9999, clientY: 0 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(100)

    // Cleanup after pointerup
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('axis="y" tracks clientY deltas', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDragResize({ axis: 'y', startValue: 250, min: 120, max: 500, onChange }),
    )

    act(() => {
      result.current.onPointerDown({
        clientX: 0,
        clientY: 100,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    // Drag up by 30 (smaller clientY) → height = 250 + (100 - 70) = 280
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 70 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(280)
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
  })

  it('calls onCommit with the final value on pointerup', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() =>
      useDragResize({
        axis: 'x',
        startValue: 200,
        min: 100,
        max: 400,
        onChange: () => undefined,
        onCommit,
      }),
    )
    act(() => {
      result.current.onPointerDown({
        clientX: 0,
        clientY: 0,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 75, clientY: 0 }))
    })
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(onCommit).toHaveBeenCalledWith(275)
  })

  it('writes to localStorage on commit only when persistKey is set', () => {
    const { result } = renderHook(() =>
      useDragResize({
        axis: 'x',
        startValue: 200,
        min: 100,
        max: 400,
        onChange: () => undefined,
        persistKey: 'test-drag-width',
      }),
    )
    act(() => {
      result.current.onPointerDown({
        clientX: 0,
        clientY: 0,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 0 }))
    })
    // Not yet committed → no localStorage write
    expect(localStorage.getItem('test-drag-width')).toBeNull()
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(localStorage.getItem('test-drag-width')).toBe('250')
  })

  it('removes document listeners on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result, unmount } = renderHook(() =>
      useDragResize({ axis: 'x', startValue: 200, min: 100, max: 400, onChange: () => undefined }),
    )
    act(() => {
      result.current.onPointerDown({
        clientX: 0,
        clientY: 0,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    // pointerdown installs 3 document listeners
    expect(removeSpy).not.toHaveBeenCalledWith('pointermove', expect.any(Function))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function))
  })

  it('direction: "invert" flips the delta sign so dragging up GROWS the value', () => {
    // Used by AIChatPanel — the handle sits on the INNER edge of a bottom-
    // anchored panel, so dragging up must grow it (not shrink it).
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDragResize({
        axis: 'y',
        startValue: 250,
        min: 120,
        max: 500,
        direction: 'invert',
        onChange,
      }),
    )

    act(() => {
      result.current.onPointerDown({
        clientX: 0,
        clientY: 100,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    // Drag up by 30 (smaller clientY) → with invert, value = 250 + 30 = 280
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 70 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(280)
    // Drag down by 50 → value shrinks: 280 - 50 = 230
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 120 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(230)
    // Clamps on the upper bound: drag up far past max → 500
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: -9999 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(500)
    // Clamps on the lower bound: drag down far past min → 120
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 9999 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(120)
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
  })

  it('asPercentOfContainer computes the value against the container width', () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ width: 1000, height: 0, top: 0, left: 0, right: 1000, bottom: 0, x: 0, y: 0, toJSON: () => '' }),
    })
    document.body.appendChild(container)
    const ref = { current: container } as React.RefObject<HTMLElement>
    const { result } = renderHook(() =>
      useDragResize({
        axis: 'x',
        startValue: 50,
        containerRef: ref,
        min: 25,
        max: 75,
        asPercentOfContainer: true,
        onChange,
      }),
    )
    act(() => {
      result.current.onPointerDown({
        clientX: 0,
        clientY: 0,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        preventDefault: () => undefined,
        target: document.createElement('div'),
      } as unknown as React.PointerEvent)
    })
    // 100px move on a 1000px container = +10%
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 0 }))
    })
    expect(onChange).toHaveBeenLastCalledWith(60)
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'))
    })
    document.body.removeChild(container)
  })
})
