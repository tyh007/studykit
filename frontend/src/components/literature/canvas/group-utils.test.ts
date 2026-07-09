import { describe, expect, it } from 'vitest';
import {
  computeAutoFitGroup,
  ensureGroupBelowChildren,
  findContainingGroup,
  getBoundsForNodes,
  getGroupChildIds,
  getNodeBounds,
  getNodeCenter,
  isPointInBounds,
  isTrueGroupNode,
} from './group-utils';
import type { CanvasFlowNode } from './canvas-types';

function node(partial: Partial<CanvasFlowNode> & { id: string; contentJson?: any }): CanvasFlowNode {
  const { contentJson, id, ...rest } = partial;
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    width: 100,
    height: 80,
    data: {
      canvasNode: {
        id,
        canvas_id: 'canvas-1',
        node_type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        z_index: 0,
        content_json: contentJson ?? {},
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
    ...rest,
  } as CanvasFlowNode;
}

function groupNode(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  childIds: string[] = []
): CanvasFlowNode {
  return node({
    id,
    type: 'group',
    position,
    width: size.width,
    height: size.height,
    contentJson: { group_mode: 'true_group', child_node_ids: childIds, label: 'G' },
  });
}

describe('group utils', () => {
  it('recognizes true group child ids', () => {
    const group = node({
      id: 'group-1',
      type: 'group',
      contentJson: { group_mode: 'true_group', child_node_ids: ['a', 'b', 3] },
    });

    expect(isTrueGroupNode(group)).toBe(true);
    expect(getGroupChildIds(group)).toEqual(['a', 'b']);
  });

  it('computes bounds for selected nodes', () => {
    expect(
      getBoundsForNodes([
        node({ id: 'a', position: { x: 10, y: 20 }, width: 100, height: 80 }),
        node({ id: 'b', position: { x: 80, y: 90 }, width: 160, height: 120 }),
      ])
    ).toEqual({ minX: 10, minY: 20, maxX: 240, maxY: 210, width: 230, height: 190 });
  });

  it('getNodeBounds and getNodeCenter default to sensible fallbacks', () => {
    const a = node({ id: 'a', width: undefined, height: undefined });
    expect(getNodeBounds(a)).toEqual({ x: 0, y: 0, width: 240, height: 140 });
    expect(getNodeCenter(a)).toEqual({ x: 120, y: 70 });
  });

  it('isPointInBounds detects inclusion', () => {
    const b = { x: 10, y: 10, width: 100, height: 50 };
    expect(isPointInBounds(50, 30, b)).toBe(true);
    expect(isPointInBounds(5, 30, b)).toBe(false);
    expect(isPointInBounds(150, 30, b)).toBe(false);
  });

  it('findContainingGroup picks the smallest group whose bounds contain the center', () => {
    const big = groupNode('big', { x: 0, y: 0 }, { width: 400, height: 400 });
    const small = groupNode('small', { x: 50, y: 50 }, { width: 100, height: 100 });
    const target = node({ id: 't', position: { x: 80, y: 80 }, width: 40, height: 40 });
    expect(findContainingGroup(target, [big, small])?.id).toBe('small');
  });

  it('findContainingGroup returns null when no group contains the node', () => {
    const g = groupNode('g', { x: 0, y: 0 }, { width: 50, height: 50 });
    const t = node({ id: 't', position: { x: 200, y: 200 }, width: 40, height: 40 });
    expect(findContainingGroup(t, [g])).toBeNull();
  });

  it('computeAutoFitGroup wraps all children with padding and header offset', () => {
    const g = groupNode('g', { x: 0, y: 0 }, { width: 400, height: 400 });
    const c1 = node({ id: 'c1', position: { x: 100, y: 100 }, width: 80, height: 60 });
    const c2 = node({ id: 'c2', position: { x: 250, y: 200 }, width: 100, height: 80 });
    const fit = computeAutoFitGroup(g, [c1, c2]);
    expect(fit).not.toBeNull();
    expect(fit!.width).toBeGreaterThanOrEqual(220);
    expect(fit!.height).toBeGreaterThanOrEqual(140);
  });

  it('computeAutoFitGroup returns null when no children', () => {
    const g = groupNode('g', { x: 0, y: 0 }, { width: 200, height: 200 });
    expect(computeAutoFitGroup(g, [])).toBeNull();
  });

  it('ensureGroupBelowChildren returns min-child-z minus 1', () => {
    const g = groupNode('g', { x: 0, y: 0 }, { width: 200, height: 200 });
    const children = [
      node({ id: 'c1', zIndex: 3 } as any),
      node({ id: 'c2', zIndex: 7 } as any),
    ];
    expect(ensureGroupBelowChildren(g, children)).toBe(2);
  });
});
