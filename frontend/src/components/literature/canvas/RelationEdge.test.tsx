import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RelationEdge from './RelationEdge'

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ id, style, markerStart, markerEnd }: { id: string; style: React.CSSProperties; markerStart?: string; markerEnd?: string }) => (
    <path
      data-testid={`edge-${id}`}
      data-marker-start={markerStart}
      data-marker-end={markerEnd}
      style={style}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M0 0 L100 100', 50, 50],
}))

const baseProps = {
  id: 'edge-1',
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: 'right',
  targetPosition: 'left',
}

describe('RelationEdge', () => {
  it('renders the paper relation label and color from top-level relation_type', () => {
    render(
      <svg>
        <RelationEdge
          {...baseProps}
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              relation_type: 'supports',
            },
          }}
        />
      </svg>,
    )

    expect(screen.getByText('Supports')).toBeInTheDocument()
    expect(screen.getByTestId('edge-edge-1')).toHaveStyle({ stroke: '#22c55e' })
  })

  it('falls back to content_json.relation_type for older canvas edge payloads', () => {
    render(
      <svg>
        <RelationEdge
          {...baseProps}
          id="edge-2"
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              content_json: { relation_type: 'contradicts' },
            },
          }}
        />
      </svg>,
    )

    expect(screen.getByText('Contradicts')).toBeInTheDocument()
    expect(screen.getByTestId('edge-edge-2')).toHaveStyle({ stroke: '#ef4444' })
  })

  it('renders a delete affordance for selected edges', () => {
    const onDelete = vi.fn()

    render(
      <svg>
        <RelationEdge
          {...baseProps}
          selected
          data={{
            canvasEdge: {
              edge_type: 'canvas',
              content_json: { relation_type: 'link' },
            },
            actions: { onDelete },
          }}
        />
      </svg>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected connection' }))
    expect(onDelete).toHaveBeenCalledWith('edge-1')
  })

  it('renders custom relation label with end-arrow marker and dashed style', () => {
    render(
      <svg>
        <RelationEdge
          {...baseProps}
          id="edge-3"
          data={{
            canvasEdge: {
              edge_type: 'canvas',
              content_json: { relation_type: 'custom', custom_label: '启发' },
              style_json: {
                color: '#8b5cf6',
                arrowEnd: 'double',
                arrowStart: 'none',
                dashStyle: 'dotted',
              },
            },
          }}
        />
      </svg>,
    )

    expect(screen.getByText('启发')).toBeInTheDocument()
    const path = screen.getByTestId('edge-edge-3')
    expect(path).toHaveAttribute('data-marker-end', 'marker-edge-3-end-double')
    expect(path).toHaveStyle({ stroke: '#8b5cf6' })
  })

  it('emits onUpdateKind when style popover changes are committed', () => {
    const onUpdateKind = vi.fn()

    render(
      <svg>
        <RelationEdge
          {...baseProps}
          id="edge-4"
          selected
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              relation_type: 'related',
              content_json: { relation_type: 'related' },
              style_json: { color: '#6b7280', arrowEnd: 'single', dashStyle: 'dashed' },
            },
            actions: { onUpdateKind },
          }}
        />
      </svg>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change line style' }))
    // Style popover is open: click "Solid"
    const solidBtn = screen.getByRole('button', { name: /Solid/ })
    fireEvent.click(solidBtn)
    expect(onUpdateKind).toHaveBeenCalled()
  })
})
