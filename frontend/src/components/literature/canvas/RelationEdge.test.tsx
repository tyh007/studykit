import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RelationEdge from './RelationEdge'

vi.mock('@xyflow/react', () => ({
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
    const { container } = render(
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
    // The main path uses the relation color
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
    expect(paths[0].getAttribute('stroke')).toBe('#22c55e')
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

  it('renders a custom relation label with a visible arrow head path', () => {
    const { container } = render(
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
                arrowEnd: 'single',
                arrowStart: 'none',
                dashStyle: 'dotted',
              },
            },
          }}
        />
      </svg>,
    )

    expect(screen.getByText('启发')).toBeInTheDocument()
    const paths = container.querySelectorAll('path')
    // We expect: 1 main line + 1 transparent interaction overlay + 1 arrow head = 3 paths
    expect(paths.length).toBeGreaterThanOrEqual(3)
    // The main line should be the dotted line (stroke-dasharray set)
    const main = paths[0]
    expect(main.getAttribute('stroke-dasharray')).toBe('1 5')
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
    const solidBtn = screen.getByRole('button', { name: /Solid/ })
    fireEvent.click(solidBtn)
    expect(onUpdateKind).toHaveBeenCalled()
  })

  it('renders a double arrow head for double arrows', () => {
    const { container } = render(
      <svg>
        <RelationEdge
          {...baseProps}
          id="edge-5"
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              relation_type: 'contradicts',
              content_json: { relation_type: 'contradicts' },
              style_json: {
                color: '#ef4444',
                arrowEnd: 'double',
                arrowStart: 'none',
                dashStyle: 'solid',
              },
            },
          }}
        />
      </svg>,
    )

    // Double arrow renders two path elements for the end: a filled triangle + a chevron
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(4)
  })
})
