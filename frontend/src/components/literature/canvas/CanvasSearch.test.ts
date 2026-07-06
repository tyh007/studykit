import { describe, expect, it } from 'vitest';
import { buildCanvasSearchResults } from './CanvasSearch';
import type { CanvasFlowNode } from './canvas-types';

function makeNode(partial: Partial<CanvasFlowNode>): CanvasFlowNode {
  return {
    id: 'node-1',
    type: 'text',
    position: { x: 0, y: 0 },
    data: {
      canvasNode: {
        id: 'node-1',
        canvas_id: 'canvas-1',
        node_type: 'text',
        x: 0,
        y: 0,
        width: 200,
        height: 120,
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

describe('buildCanvasSearchResults', () => {
  it('finds paper metadata and note text', () => {
    const results = buildCanvasSearchResults(
      [
        makeNode({
          id: 'paper-node',
          type: 'paper',
          data: {
            canvasNode: {
              id: 'paper-node',
              canvas_id: 'canvas-1',
              node_type: 'paper',
              ref_type: 'paper',
              ref_id: 'paper-1',
              x: 0,
              y: 0,
              width: 300,
              height: 200,
              z_index: 0,
              content_json: {},
              style_json: {},
              created_at: '',
              updated_at: '',
            },
            paper: {
              id: 'paper-1',
              project_id: 'project-1',
              workspace_id: 'workspace-1',
              file_name: 'method.pdf',
              file_size: 1,
              file_type: 'application/pdf',
              uploaded_at: '',
              title: 'Working Memory Methods',
              authors: 'Baddeley',
              processing_status: 'completed',
              in_trash: false,
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
        }),
        makeNode({
          id: 'note-node',
          type: 'note',
          data: {
            canvasNode: {
              id: 'note-node',
              canvas_id: 'canvas-1',
              node_type: 'note',
              x: 0,
              y: 0,
              width: 240,
              height: 140,
              z_index: 0,
              content_json: { text: 'Compare attention switching evidence' },
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
        }),
      ],
      'attention'
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'note-node', type: 'note' });
  });

  it('returns no results for blank queries', () => {
    expect(buildCanvasSearchResults([makeNode({})], '   ')).toEqual([]);
  });
});
