const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

async function getWorkspaceId(userId) {
  const r = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  return r.rows[0]?.id;
}

async function verifyProjectOwnership(projectId, workspaceId) {
  const r = await db.query(
    'SELECT id FROM literature_projects WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL',
    [projectId, workspaceId]
  );
  return r.rows.length > 0;
}

async function getCanvasForWorkspace(canvasId, workspaceId) {
  const r = await db.query(
    `SELECT id, project_id, workspace_id, title, viewport_json, settings_json, created_at, updated_at
     FROM literature_canvases
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [canvasId, workspaceId]
  );
  return r.rows[0] || null;
}

async function assertPaperBelongsToCanvas(paperId, canvas, { allowTrash = false } = {}) {
  const r = await db.query(
    `SELECT id FROM literature_papers
     WHERE id = $1 AND workspace_id = $2 AND project_id = $3
       AND deleted_at IS NULL
       ${allowTrash ? '' : 'AND in_trash = false'}`,
    [paperId, canvas.workspace_id, canvas.project_id]
  );
  return r.rows.length > 0;
}

function edgeRowWithRelation(row, relationType) {
  return {
    ...row,
    relation_type: relationType || row.relation_type || null,
    content_json: {
      ...(row.content_json || {}),
      ...(relationType || row.relation_type ? { relation_type: relationType || row.relation_type } : {}),
    },
  };
}

function isValidViewport(viewport) {
  return (
    viewport &&
    typeof viewport.x === 'number' &&
    typeof viewport.y === 'number' &&
    typeof viewport.zoom === 'number'
  );
}

/**
 * GET /api/literature/canvas?projectId=xxx
 * Returns the project's default canvas. Creates one if none exists.
 */
router.get('/', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.json([]);

    if (!(await verifyProjectOwnership(projectId, ws))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const existing = await db.query(
      `SELECT id, project_id, workspace_id, title, viewport_json, settings_json, created_at, updated_at
       FROM literature_canvases
       WHERE project_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [projectId]
    );
    if (existing.rows.length > 0) {
      return res.json([existing.rows[0]]);
    }

    // Create a default canvas
    const id = uuidv4();
    await db.query(
      `INSERT INTO literature_canvases (id, project_id, workspace_id, title, viewport_json, settings_json)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb)`,
      [id, projectId, ws, 'Canvas']
    );
    const created = await db.query(
      `SELECT id, project_id, workspace_id, title, viewport_json, settings_json, created_at, updated_at
       FROM literature_canvases WHERE id = $1`,
      [id]
    );
    res.json(created.rows);
  } catch (err) {
    console.error('List/canvas error:', err);
    res.status(500).json({ error: 'Failed to load canvas' });
  }
});

/**
 * GET /api/literature/canvas/:canvasId/state
 * Returns { canvas, nodes, edges, papers }.
 */
router.get('/:canvasId/state', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    const nodes = await db.query(
      `SELECT id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index,
              content_json, style_json, created_at, updated_at
       FROM literature_canvas_nodes
       WHERE canvas_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [canvasId]
    );
    const edges = await db.query(
      `SELECT e.id, e.canvas_id, e.source_node_id, e.target_node_id, e.relation_id, e.edge_type,
              e.label, e.content_json, e.style_json, e.created_at, e.updated_at,
              pr.relation_type
       FROM literature_canvas_edges e
       LEFT JOIN paper_relations pr ON pr.id = e.relation_id
       WHERE e.canvas_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at ASC`,
      [canvasId]
    );
    const scenes = await db.query(
      `SELECT id, canvas_id, name, viewport_json, sort_order, created_at, updated_at
       FROM literature_canvas_scenes
       WHERE canvas_id = $1 AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
      [canvasId]
    );

    // Include paper rows referenced by paper nodes (avoid full_text bloat)
    const paperIds = [
      ...new Set(
        nodes.rows
          .filter((n) => n.ref_type === 'paper' && n.ref_id)
          .map((n) => n.ref_id)
      ),
    ];
    let papers = [];
    if (paperIds.length > 0) {
      const r = await db.query(
        `SELECT id, project_id, workspace_id, file_name, file_size, file_type, uploaded_at,
                processed_at, title, authors, year, journal, doi, abstract, extracted_data,
                reading_status, importance, processing_status, error_message,
                storage_key, citation_item_id, in_trash, trashed_at,
                created_at, updated_at
         FROM literature_papers
         WHERE id = ANY($1::uuid[])
           AND workspace_id = $2
           AND project_id = $3
           AND deleted_at IS NULL`,
        [paperIds, ws, canvas.project_id]
      );
      papers = r.rows;
    }

    res.json({
      canvas,
      nodes: nodes.rows,
      edges: edges.rows.map((row) => edgeRowWithRelation(row)),
      scenes: scenes.rows,
      papers,
    });
  } catch (err) {
    console.error('Get canvas state error:', err);
    res.status(500).json({ error: 'Failed to load canvas state' });
  }
});

/**
 * PATCH /api/literature/canvas/:canvasId/viewport
 * Body: { viewport: { x: number, y: number, zoom: number } }
 */
router.patch('/:canvasId/viewport', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const { viewport } = req.body;
    if (
      !viewport ||
      typeof viewport.x !== 'number' ||
      typeof viewport.y !== 'number' ||
      typeof viewport.zoom !== 'number'
    ) {
      return res.status(400).json({ error: 'viewport { x, y, zoom } required' });
    }
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const r = await db.query(
      `UPDATE literature_canvases
       SET viewport_json = $1::jsonb, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3 AND deleted_at IS NULL
       RETURNING id, project_id, workspace_id, title, viewport_json, settings_json, created_at, updated_at`,
      [JSON.stringify(viewport), canvasId, ws]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Canvas not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Update viewport error:', err);
    res.status(500).json({ error: 'Failed to update viewport' });
  }
});

/**
 * GET /api/literature/canvas/:canvasId/scenes
 */
router.get('/:canvasId/scenes', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    const r = await db.query(
      `SELECT id, canvas_id, name, viewport_json, sort_order, created_at, updated_at
       FROM literature_canvas_scenes
       WHERE canvas_id = $1 AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC`,
      [canvasId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('List scenes error:', err);
    res.status(500).json({ error: 'Failed to load scenes' });
  }
});

/**
 * POST /api/literature/canvas/:canvasId/scenes
 * Body: { name: string, viewport: { x, y, zoom }, sort_order?: number }
 */
router.post('/:canvasId/scenes', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const { name, viewport, sort_order } = req.body;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return res.status(400).json({ error: 'Scene name is required' });
    if (!isValidViewport(viewport)) {
      return res.status(400).json({ error: 'viewport { x, y, zoom } required' });
    }

    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    let nextOrder = sort_order;
    if (typeof nextOrder !== 'number') {
      const order = await db.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM literature_canvas_scenes
         WHERE canvas_id = $1 AND deleted_at IS NULL`,
        [canvasId]
      );
      nextOrder = order.rows[0]?.next_order ?? 0;
    }

    const id = uuidv4();
    const r = await db.query(
      `INSERT INTO literature_canvas_scenes (id, canvas_id, name, viewport_json, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, canvas_id, name, viewport_json, sort_order, created_at, updated_at`,
      [id, canvasId, cleanName, JSON.stringify(viewport), nextOrder]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('Create scene error:', err);
    res.status(500).json({ error: 'Failed to create scene' });
  }
});

/**
 * PATCH /api/literature/canvas/:canvasId/scenes/:sceneId
 */
router.patch('/:canvasId/scenes/:sceneId', async (req, res) => {
  try {
    const { canvasId, sceneId } = req.params;
    const { name, viewport, sort_order } = req.body;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) {
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanName) return res.status(400).json({ error: 'Scene name is required' });
      fields.push(`name = $${idx++}`);
      values.push(cleanName);
    }
    if (viewport !== undefined) {
      if (!isValidViewport(viewport)) {
        return res.status(400).json({ error: 'viewport { x, y, zoom } required' });
      }
      fields.push(`viewport_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(viewport));
    }
    if (sort_order !== undefined) {
      if (typeof sort_order !== 'number') {
        return res.status(400).json({ error: 'sort_order must be a number' });
      }
      fields.push(`sort_order = $${idx++}`);
      values.push(sort_order);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push('updated_at = NOW()');
    values.push(canvasId, sceneId);

    const r = await db.query(
      `UPDATE literature_canvas_scenes SET ${fields.join(', ')}
       WHERE canvas_id = $${idx++} AND id = $${idx} AND deleted_at IS NULL
       RETURNING id, canvas_id, name, viewport_json, sort_order, created_at, updated_at`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Scene not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Update scene error:', err);
    res.status(500).json({ error: 'Failed to update scene' });
  }
});

/**
 * DELETE /api/literature/canvas/:canvasId/scenes/:sceneId
 */
router.delete('/:canvasId/scenes/:sceneId', async (req, res) => {
  try {
    const { canvasId, sceneId } = req.params;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    const r = await db.query(
      `UPDATE literature_canvas_scenes SET deleted_at = NOW(), updated_at = NOW()
       WHERE canvas_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [canvasId, sceneId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Scene not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete scene error:', err);
    res.status(500).json({ error: 'Failed to delete scene' });
  }
});

/**
 * POST /api/literature/canvas/:canvasId/nodes
 */
router.post('/:canvasId/nodes', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const {
      node_type,
      ref_type,
      ref_id,
      x,
      y,
      width,
      height,
      z_index,
      content_json,
      style_json,
    } = req.body;
    if (!node_type || typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'node_type, x, y are required' });
    }
    const valid = ['paper', 'note', 'text', 'question', 'group', 'shape'];
    if (!valid.includes(node_type)) {
      return res.status(400).json({ error: 'invalid node_type' });
    }

    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
    if (ref_id || ref_type) {
      if (node_type !== 'paper' || ref_type !== 'paper' || !ref_id) {
        return res.status(400).json({ error: 'Only paper nodes may reference external records' });
      }
      if (!(await assertPaperBelongsToCanvas(ref_id, canvas))) {
        return res.status(400).json({ error: 'Referenced paper is not in this canvas project' });
      }
    }

    const id = uuidv4();
    const r = await db.query(
      `INSERT INTO literature_canvas_nodes
        (id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index, content_json, style_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index,
                 content_json, style_json, created_at, updated_at`,
      [
        id,
        canvasId,
        node_type,
        ref_type || null,
        ref_id || null,
        x,
        y,
        width ?? 260,
        height ?? 160,
        z_index ?? 0,
        JSON.stringify(content_json || {}),
        JSON.stringify(style_json || {}),
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('Create node error:', err);
    res.status(500).json({ error: 'Failed to create node' });
  }
});

/**
 * PATCH /api/literature/canvas/:canvasId/nodes/:nodeId
 */
router.patch('/:canvasId/nodes/:nodeId', async (req, res) => {
  try {
    const { canvasId, nodeId } = req.params;
    const { x, y, width, height, z_index, content_json, style_json } = req.body;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
    const fields = [];
    const values = [];
    let idx = 1;
    const set = (col, val, isJsonb = false) => {
      fields.push(`${col} = $${idx++}`);
      values.push(isJsonb ? JSON.stringify(val) : val);
    };
    if (x !== undefined) set('x', x);
    if (y !== undefined) set('y', y);
    if (width !== undefined) set('width', width);
    if (height !== undefined) set('height', height);
    if (z_index !== undefined) set('z_index', z_index);
    if (content_json !== undefined) set('content_json', content_json, true);
    if (style_json !== undefined) set('style_json', style_json, true);
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push('updated_at = NOW()');
    values.push(canvasId, nodeId);
    const r = await db.query(
      `UPDATE literature_canvas_nodes SET ${fields.join(', ')}
       WHERE canvas_id = $${idx++} AND id = $${idx} AND deleted_at IS NULL
       RETURNING id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index,
                 content_json, style_json, created_at, updated_at`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Node not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Update node error:', err);
    res.status(500).json({ error: 'Failed to update node' });
  }
});

/**
 * DELETE /api/literature/canvas/:canvasId/nodes/:nodeId
 * Soft-delete the node and any connected canvas edges.
 */
router.delete('/:canvasId/nodes/:nodeId', async (req, res) => {
  const { canvasId, nodeId } = req.params;
  const client = await db.getClient();
  try {
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
    await client.query('BEGIN');
    await client.query(
      `UPDATE literature_canvas_edges SET deleted_at = NOW()
       WHERE canvas_id = $1 AND (source_node_id = $2 OR target_node_id = $2) AND deleted_at IS NULL`,
      [canvasId, nodeId]
    );
    await client.query(
      `UPDATE literature_canvas_nodes SET deleted_at = NOW(), updated_at = NOW()
       WHERE canvas_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [canvasId, nodeId]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete node error:', err);
    res.status(500).json({ error: 'Failed to delete node' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/literature/canvas/:canvasId/edges
 * If edge_type === 'paper_relation', both endpoints must be paper nodes
 * and a paper_relations row is upserted.
 */
router.post('/:canvasId/edges', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const {
      source_node_id,
      target_node_id,
      edge_type = 'canvas',
      relation_type,
      label,
      content_json,
      style_json,
    } = req.body;
    if (!source_node_id || !target_node_id) {
      return res.status(400).json({ error: 'source_node_id and target_node_id are required' });
    }
    if (!['canvas', 'paper_relation'].includes(edge_type)) {
      return res.status(400).json({ error: 'invalid edge_type' });
    }

    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    let relationId = null;

    let effectiveEdgeType = edge_type;
    if (edge_type === 'paper_relation') {
      const validTypes = ['cites', 'extends', 'contradicts', 'supports', 'related', 'method', 'dataset'];
      if (!relation_type) {
        return res.status(400).json({ error: 'relation_type required for paper_relation edges' });
      }
      // 'custom' (or any unknown string) means a free-form typed canvas edge
      // between two papers: still stored as a canvas edge so it doesn't pollute
      // the paper_relations enum, but relation_type is preserved in content_json.
      if (!validTypes.includes(relation_type)) {
        effectiveEdgeType = 'canvas';
      } else {
        // Resolve both endpoint paper_ids
        const endpoints = await db.query(
          `SELECT id, node_type, ref_id FROM literature_canvas_nodes
           WHERE canvas_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
          [canvasId, [source_node_id, target_node_id]]
        );
        if (endpoints.rows.length !== 2) {
          return res.status(404).json({ error: 'Source or target node not found on this canvas' });
        }
        const src = endpoints.rows.find((r) => r.id === source_node_id);
        const tgt = endpoints.rows.find((r) => r.id === target_node_id);
        if (!src || !tgt || src.node_type !== 'paper' || tgt.node_type !== 'paper' || !src.ref_id || !tgt.ref_id) {
          return res.status(400).json({ error: 'paper_relation edges require two paper nodes' });
        }
        const papers = await db.query(
          `SELECT id FROM literature_papers
           WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND project_id = $3
             AND deleted_at IS NULL AND in_trash = false`,
          [[src.ref_id, tgt.ref_id], canvas.workspace_id, canvas.project_id]
        );
        if (papers.rows.length !== 2) {
          return res.status(400).json({ error: 'paper_relation edges require papers in this canvas project' });
        }
        // Upsert paper_relations row
        const up = await db.query(
          `INSERT INTO paper_relations (id, source_paper_id, target_paper_id, relation_type, description)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_paper_id, target_paper_id, relation_type)
           DO UPDATE SET description = COALESCE(EXCLUDED.description, paper_relations.description)
           RETURNING id`,
          [uuidv4(), src.ref_id, tgt.ref_id, relation_type, label || null]
        );
        relationId = up.rows[0]?.id || null;
      }
    }

    const id = uuidv4();
    const r = await db.query(
      `INSERT INTO literature_canvas_edges
        (id, canvas_id, source_node_id, target_node_id, relation_id, edge_type, label, content_json, style_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, canvas_id, source_node_id, target_node_id, relation_id, edge_type,
                 label, content_json, style_json, created_at, updated_at`,
      [
        id,
        canvasId,
        source_node_id,
        target_node_id,
        relationId,
        effectiveEdgeType,
        label || null,
        JSON.stringify({
          ...(content_json || {}),
          ...(relation_type ? { relation_type } : {}),
        }),
        JSON.stringify(style_json || {}),
      ]
    );
    res.status(201).json(edgeRowWithRelation(r.rows[0], relation_type || null));
  } catch (err) {
    console.error('Create edge error:', err);
    res.status(500).json({ error: 'Failed to create edge' });
  }
});

/**
 * PATCH /api/literature/canvas/:canvasId/edges/:edgeId
 */
router.patch('/:canvasId/edges/:edgeId', async (req, res) => {
  try {
    const { canvasId, edgeId } = req.params;
    const { label, content_json, style_json } = req.body;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
    const fields = [];
    const values = [];
    let idx = 1;
    if (label !== undefined) {
      fields.push(`label = $${idx++}`);
      values.push(label);
    }
    if (content_json !== undefined) {
      fields.push(`content_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(content_json));
    }
    if (style_json !== undefined) {
      fields.push(`style_json = $${idx++}::jsonb`);
      values.push(JSON.stringify(style_json));
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    fields.push('updated_at = NOW()');
    values.push(canvasId, edgeId);
    const r = await db.query(
      `UPDATE literature_canvas_edges SET ${fields.join(', ')}
       WHERE canvas_id = $${idx++} AND id = $${idx} AND deleted_at IS NULL
       RETURNING id, canvas_id, source_node_id, target_node_id, relation_id, edge_type,
                 label, content_json, style_json, created_at, updated_at`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Edge not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Update edge error:', err);
    res.status(500).json({ error: 'Failed to update edge' });
  }
});

/**
 * DELETE /api/literature/canvas/:canvasId/edges/:edgeId
 * Soft-delete the canvas edge only. Does not delete paper_relations.
 */
router.delete('/:canvasId/edges/:edgeId', async (req, res) => {
  try {
    const { canvasId, edgeId } = req.params;
    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
    const r = await db.query(
      `UPDATE literature_canvas_edges SET deleted_at = NOW(), updated_at = NOW()
       WHERE canvas_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [canvasId, edgeId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Edge not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete edge error:', err);
    res.status(500).json({ error: 'Failed to delete edge' });
  }
});

/**
 * POST /api/literature/canvas/:canvasId/import-papers
 * Body: { paperIds: string[], origin?: { x: number, y: number } }
 * Creates paper nodes for the given papers if not already on the canvas.
 */
router.post('/:canvasId/import-papers', async (req, res) => {
  try {
    const { canvasId } = req.params;
    const { paperIds, origin } = req.body;
    if (!Array.isArray(paperIds) || paperIds.length === 0) {
      return res.status(400).json({ error: 'paperIds array is required' });
    }
    const uniquePaperIds = [...new Set(paperIds.map((id) => String(id)))];
    if (uniquePaperIds.length > 100) {
      return res.status(400).json({ error: 'Cannot import more than 100 papers at once' });
    }

    const ws = await getWorkspaceId(req.user.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const canvas = await getCanvasForWorkspace(canvasId, ws);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });

    const validPapers = await db.query(
      `SELECT id FROM literature_papers
       WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND project_id = $3
         AND deleted_at IS NULL AND in_trash = false`,
      [uniquePaperIds, canvas.workspace_id, canvas.project_id]
    );
    if (validPapers.rows.length !== uniquePaperIds.length) {
      return res.status(400).json({ error: 'One or more papers do not belong to this canvas project' });
    }

    // Skip papers already on the canvas
    const existing = await db.query(
      `SELECT ref_id FROM literature_canvas_nodes
       WHERE canvas_id = $1 AND ref_type = 'paper' AND ref_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [canvasId, uniquePaperIds]
    );
    const existingSet = new Set(existing.rows.map((r) => r.ref_id));
    const toCreate = uniquePaperIds.filter((id) => !existingSet.has(id));
    if (toCreate.length === 0) {
      return res.json({ created: [], skipped: uniquePaperIds });
    }

    const baseX = origin?.x ?? 0;
    const baseY = origin?.y ?? 0;
    const cols = 3;
    const cellW = 320;
    const cellH = 220;
    const inserts = [];
    toCreate.forEach((paperId, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      inserts.push({
        id: uuidv4(),
        paperId,
        x: baseX + col * cellW,
        y: baseY + row * cellH,
      });
    });

    const client = await db.getClient();
    const created = [];
    try {
      await client.query('BEGIN');
      for (const ins of inserts) {
        const r = await client.query(
          `INSERT INTO literature_canvas_nodes
            (id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index, content_json, style_json)
           VALUES ($1, $2, 'paper', 'paper', $3, $4, $5, 300, 200, 0, '{}'::jsonb, '{}'::jsonb)
           RETURNING id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index,
                     content_json, style_json, created_at, updated_at`,
          [ins.id, canvasId, ins.paperId, ins.x, ins.y]
        );
        created.push(r.rows[0]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({ created, skipped: [...existingSet] });
  } catch (err) {
    console.error('Import papers error:', err);
    res.status(500).json({ error: 'Failed to import papers' });
  }
});

module.exports = router;
