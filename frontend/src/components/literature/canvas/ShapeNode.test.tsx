import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ShapeNode from './ShapeNode';
import type { CanvasFlowNode } from './canvas-types';

vi.mock('@xyflow/react', () => ({
  Handle: () => <span data-testid="handle" />,
  NodeResizer: () => <span data-testid="resizer" />,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

function makeProps(overrides: Partial<CanvasFlowNode['data']> = {}, selected = true) {
  const actions = {
    onContentChange: vi.fn(),
    onContentPatch: vi.fn(),
    onStylePatch: vi.fn(),
    onResize: vi.fn(),
    onDelete: vi.fn(),
  };
  const data: CanvasFlowNode['data'] = {
    canvasNode: {
      id: 'shape-1',
      canvas_id: 'canvas-1',
      node_type: 'shape',
      x: 0,
      y: 0,
      width: 220,
      height: 140,
      z_index: 0,
      content_json: { label: 'Hypothesis' },
      style_json: { shape: 'diamond', fill: '#F5E5BE', stroke: '#8B5CF6' },
      created_at: '',
      updated_at: '',
    },
    actions,
    ...overrides,
  };

  return {
    props: {
      id: 'shape-1',
      data,
      selected,
      type: 'shape',
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
      zIndex: 0,
    } as any,
    actions,
  };
}

describe('ShapeNode', () => {
  it('renders the configured shape and lets users switch shape type', () => {
    const { props, actions } = makeProps();
    const { container } = render(<ShapeNode {...props} />);

    expect(container.querySelector('.canvas-node-shape-diamond')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Shape type'), { target: { value: 'ellipse' } });
    expect(actions.onStylePatch).toHaveBeenCalledWith('shape-1', { shape: 'ellipse' });
  });

  it('commits edited text on blur', () => {
    const { props, actions } = makeProps();
    render(<ShapeNode {...props} />);

    fireEvent.doubleClick(screen.getByText('Hypothesis'));
    const input = screen.getByDisplayValue('Hypothesis');
    fireEvent.change(input, { target: { value: 'Mechanism' } });
    fireEvent.blur(input);

    expect(actions.onContentPatch).toHaveBeenCalledWith('shape-1', { label: 'Mechanism' });
  });
});
