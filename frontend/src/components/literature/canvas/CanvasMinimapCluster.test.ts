import { describe, expect, it } from 'vitest';
import { getCanvasMinimapLayout } from './CanvasMinimapCluster';
import type { CanvasFlowNode } from './canvas-types';

function makeNode(partial: Partial<CanvasFlowNode>): CanvasFlowNode {
  return {
    id: 'node-1',
    type: 'text',
    position: { x: 0, y: 0 },
    width: 240,
    height: 140,
    data: {
      canvasNode: {
        id: 'node-1',
        canvas_id: 'canvas-1',
        node_type: 'text',
        x: 0,
        y: 0,
        width: 240,
        height: 140,
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

describe('getCanvasMinimapLayout', () => {
  it('includes both far-away nodes and the visible viewport in the overview', () => {
    const layout = getCanvasMinimapLayout(
      [
        makeNode({ id: 'left', position: { x: -1200, y: -400 } }),
        makeNode({ id: 'right', position: { x: 1800, y: 900 }, width: 300, height: 180 }),
      ],
      { x: -200, y: -100, zoom: 1 },
      { width: 800, height: 600 }
    );

    expect(layout).not.toBeNull();
    expect(layout?.bounds).toMatchObject({
      minX: -1200,
      minY: -400,
      maxX: 2100,
      maxY: 1080,
    });
    expect(layout?.viewportRect.width).toBeGreaterThan(3);
    expect(layout?.viewportRect.height).toBeGreaterThan(3);
  });

  it('still draws the current viewport when the canvas has no nodes', () => {
    const layout = getCanvasMinimapLayout([], { x: -100, y: -80, zoom: 2 }, { width: 1000, height: 500 });

    expect(layout).not.toBeNull();
    expect(layout?.bounds).toMatchObject({
      minX: 50,
      minY: 40,
      maxX: 550,
      maxY: 290,
    });
  });
});
