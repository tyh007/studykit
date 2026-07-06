import { describe, expect, it } from 'vitest';
import { getBoundsForNodes, getGroupChildIds, isTrueGroupNode } from './group-utils';
import type { CanvasFlowNode } from './canvas-types';

function node(partial: Partial<CanvasFlowNode>): CanvasFlowNode {
  return {
    id: 'node',
    type: 'text',
    position: { x: 0, y: 0 },
    width: 100,
    height: 80,
    data: {
      canvasNode: {
        id: 'node',
        canvas_id: 'canvas-1',
        node_type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        z_index: 0,
        content_json: {},
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
    ...partial,
  } as CanvasFlowNode;
}

describe('group utils', () => {
  it('recognizes true group child ids', () => {
    const group = node({
      id: 'group-1',
      type: 'group',
      data: {
        ...node({}).data,
        canvasNode: {
          ...node({}).data.canvasNode,
          node_type: 'group',
          content_json: { group_mode: 'true_group', child_node_ids: ['a', 'b', 3] },
        },
      },
    });

    expect(isTrueGroupNode(group)).toBe(true);
    expect(getGroupChildIds(group)).toEqual(['a', 'b']);
  });

  it('computes bounds for selected nodes', () => {
    expect(
      getBoundsForNodes([
        node({ position: { x: 10, y: 20 }, width: 100, height: 80 }),
        node({ position: { x: 80, y: 90 }, width: 160, height: 120 }),
      ])
    ).toEqual({ minX: 10, minY: 20, maxX: 240, maxY: 210, width: 230, height: 190 });
  });
});
