import { describe, expect, it } from 'vitest'
import { runForceLayout } from './PaperRelationsGraph'

describe('runForceLayout', () => {
  it('returns N positions for N nodes', () => {
    const nodes = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ]
    const positions = runForceLayout(nodes, [], 800, 600)
    expect(positions).toHaveLength(3)
  })

  it('is deterministic: same input → same output', () => {
    const nodes = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ]
    const edges = [
      { id: 'e1', source_paper_id: 'a', target_paper_id: 'b', relation_type: 'cites' },
    ]
    const a = runForceLayout(nodes, edges, 800, 600)
    const b = runForceLayout(nodes, edges, 800, 600)
    expect(a).toEqual(b)
  })

  it('clamps positions within bounds (60..width-60, 40..height-40)', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, title: `N${i}` }))
    const positions = runForceLayout(nodes, [], 800, 600)
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(60)
      expect(p.x).toBeLessThanOrEqual(800 - 60)
      expect(p.y).toBeGreaterThanOrEqual(40)
      expect(p.y).toBeLessThanOrEqual(600 - 40)
    }
  })

  it('handles edges to non-existent nodes without throwing', () => {
    const nodes = [{ id: 'a', title: 'A' }]
    const edges = [
      { id: 'e1', source_paper_id: 'a', target_paper_id: 'ghost', relation_type: 'cites' },
    ]
    expect(() => runForceLayout(nodes, edges, 800, 600)).not.toThrow()
  })
})
