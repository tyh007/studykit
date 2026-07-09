import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RelationEdge from './RelationEdge'

vi.mock('@xyflow/react', () => ({
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M0 0 L100 100', 50, 50],
}))

vi.mock('./RelationTypeMenu', () => ({
  default: ({ onCancel, positioning, position }: { onCancel: () => void; positioning?: string; position?: { x: number; y: number } }) => (
    <div
      data-testid="relation-picker"
      data-positioning={positioning}
      data-x={position?.x}
      data-y={position?.y}
    >
      <button onClick={onCancel}>close-picker</button>
    </div>
  ),
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

  it('opens the full relation picker when "Change" is clicked', () => {
    const onUpdateKind = vi.fn()

    render(
      <svg>
        <RelationEdge
          {...baseProps}
          selected
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              relation_type: 'cites',
              content_json: { relation_type: 'cites' },
            },
            actions: { onUpdateKind },
          }}
        />
      </svg>,
    )

    expect(screen.queryByTestId('relation-picker')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change relation' }))
    expect(screen.getByTestId('relation-picker')).toBeInTheDocument()
  })

  it('opens the picker when the label is clicked', () => {
    const onUpdateKind = vi.fn()

    render(
      <svg>
        <RelationEdge
          {...baseProps}
          selected
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              relation_type: 'extends',
              content_json: { relation_type: 'extends' },
            },
            actions: { onUpdateKind },
          }}
        />
      </svg>,
    )

    expect(screen.queryByTestId('relation-picker')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Extends'))
    expect(screen.getByTestId('relation-picker')).toBeInTheDocument()
  })

  it('places the picker in flow space below the label and uses absolute positioning', () => {
    render(
      <svg>
        <RelationEdge
          {...baseProps}
          selected
          data={{
            canvasEdge: {
              edge_type: 'paper_relation',
              relation_type: 'cites',
              content_json: { relation_type: 'cites' },
            },
          }}
        />
      </svg>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change relation' }))
    const picker = screen.getByTestId('relation-picker')
    // getBezierPath returns labelX=50, labelY=50; we offset by +60 in y.
    expect(picker.getAttribute('data-x')).toBe('50')
    expect(picker.getAttribute('data-y')).toBe('110')
    expect(picker.getAttribute('data-positioning')).toBe('absolute-flow')
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
    expect(paths.length).toBeGreaterThanOrEqual(3)
    const main = paths[0]
    expect(main.getAttribute('stroke-dasharray')).toBe('1 5')
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

    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(4)
  })
})
