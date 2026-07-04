import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RelationEdge from './RelationEdge'

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ id, style }: { id: string; style: React.CSSProperties }) => (
    <path data-testid={`edge-${id}`} style={style} />
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
})
