import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import QuestionNode from './QuestionNode';
import type { CanvasFlowNode } from './canvas-types';

vi.mock('@xyflow/react', () => ({
  Handle: () => <span data-testid="handle" />,
  NodeResizer: () => <span data-testid="resizer" />,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

function makeNode(): CanvasFlowNode {
  return {
    id: 'question-1',
    type: 'question',
    position: { x: 0, y: 0 },
    data: {
      canvasNode: {
        id: 'question-1',
        canvas_id: 'canvas-1',
        node_type: 'question',
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        z_index: 0,
        content_json: {
          prompt: 'What is the gap?',
          text: 'The gap is unclear measurement.',
          sources: ['Working Memory Methods', 'Attention Switching Evidence'],
        },
        style_json: {},
        created_at: '',
        updated_at: '',
      },
      actions: {
        onContentChange: () => {},
        onContentPatch: () => {},
        onStylePatch: () => {},
        onResize: () => {},
        onDelete: () => {},
      },
    },
  } as CanvasFlowNode;
}

describe('QuestionNode', () => {
  it('renders AI answer source chips with source names', () => {
    render(
      <QuestionNode
        {...({
          id: 'question-1',
          data: makeNode().data,
          selected: false,
          type: 'question',
          dragging: false,
          draggable: true,
          selectable: true,
          deletable: true,
          isConnectable: true,
          positionAbsoluteX: 0,
          positionAbsoluteY: 0,
          zIndex: 0,
        } as any)}
      />
    );

    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Working Memory Methods')).toBeInTheDocument();
    expect(screen.getByText('Attention Switching Evidence')).toBeInTheDocument();
  });
});
