import { act, fireEvent, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { useHorizontalScroller } from './useHorizontalScroller';

interface ProbeProps {
  scrollWidth?: number;
  clientWidth?: number;
  disabled?: boolean;
  onReady?: (handle: {
    el: HTMLDivElement;
    /** Mutates in place; reads the current value at call time. */
    state: { isDragging: boolean; hasOverflowLeft: boolean; hasOverflowRight: boolean };
  }) => void;
}

function Probe({ scrollWidth = 1000, clientWidth = 200, disabled, onReady }: ProbeProps) {
  const { ref, state } = useHorizontalScroller({ disabled });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    Object.defineProperty(el, 'scrollWidth', {
      configurable: true,
      get: () => scrollWidth,
    });
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => clientWidth,
    });
    el.dispatchEvent(new Event('scroll'));
    if (onReady) {
      onReady({ el, state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="probe-wrapper">
      <div ref={ref} data-testid="probe-scroll" />
    </div>
  );
}

describe('useHorizontalScroller', () => {
  it('reports right overflow when content is wider than container', () => {
    let handle: any = null;
    render(
      <Probe
        scrollWidth={1000}
        clientWidth={200}
        onReady={(h) => {
          handle = h;
        }}
      />
    );
    expect(handle).not.toBeNull();
    expect(handle!.state.hasOverflowRight).toBe(true);
    expect(handle!.state.hasOverflowLeft).toBe(false);
  });

  it('reports no overflow when content fits', () => {
    let handle: any = null;
    render(
      <Probe
        scrollWidth={150}
        clientWidth={200}
        onReady={(h) => {
          handle = h;
        }}
      />
    );
    expect(handle).not.toBeNull();
    expect(handle!.state.hasOverflowLeft).toBe(false);
    expect(handle!.state.hasOverflowRight).toBe(false);
  });

  it('drags the container when pointer moves past the threshold', () => {
    let handle: any = null;
    render(
      <Probe
        scrollWidth={1000}
        clientWidth={200}
        onReady={(h) => {
          handle = h;
        }}
      />
    );
    const el = handle.el as HTMLDivElement;

    act(() => {
      fireEvent.pointerDown(el, { clientX: 100, clientY: 10, button: 0, pointerId: 1 });
    });
    // Below threshold - should not start dragging
    act(() => {
      fireEvent.pointerMove(el, { clientX: 102, clientY: 10, pointerId: 1 });
    });
    expect(handle!.state.isDragging).toBe(false);

    // Above threshold - should start dragging
    act(() => {
      fireEvent.pointerMove(el, { clientX: 60, clientY: 10, pointerId: 1 });
    });
    expect(handle!.state.isDragging).toBe(true);

    act(() => {
      fireEvent.pointerUp(el, { clientX: 60, clientY: 10, pointerId: 1 });
    });
  });

  it('is a no-op when disabled', () => {
    let handle: any = null;
    render(
      <Probe
        scrollWidth={1000}
        clientWidth={200}
        disabled
        onReady={(h) => {
          handle = h;
        }}
      />
    );
    expect(handle).not.toBeNull();
    const el = handle.el as HTMLDivElement;

    act(() => {
      fireEvent.pointerDown(el, { clientX: 100, clientY: 10, button: 0, pointerId: 1 });
      fireEvent.pointerMove(el, { clientX: 50, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(el, { clientX: 50, clientY: 10, pointerId: 1 });
    });
    expect(handle!.state.isDragging).toBe(false);
  });

  it('skips drag if a button is the pointerdown target (preserves click)', () => {
    let handle: any = null;
    render(
      <Probe
        scrollWidth={1000}
        clientWidth={200}
        onReady={(h) => {
          handle = h;
        }}
      />
    );
    const parent = handle.el as HTMLDivElement;
    const button = document.createElement('button');
    button.textContent = 'x';
    parent.appendChild(button);

    act(() => {
      fireEvent.pointerDown(button, { clientX: 100, clientY: 10, button: 0, pointerId: 1 });
      fireEvent.pointerMove(button, { clientX: 50, clientY: 10, pointerId: 1 });
    });
    expect(handle!.state.isDragging).toBe(false);
  });
});
