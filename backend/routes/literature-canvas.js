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

    const c = await db.query(
      `SELECT id, project_id, workspace_id, title, viewport_json, settings_json, created_at, updated_at
       FROM literature_canvases
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [canvasId, ws]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: 'Canvas not found' });

    const nodes = await db.query(
      `SELECT id, canvas_id, node_type, ref_type, ref_id, x, y, width, height, z_index,
              content_json, style_json, created_at, updated_at
       FROM literature_canvas_nodes
       WHERE canvas_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [canvasId]
    );
    const edges = await db.query(
      `SELECT id, canvas_id, source_node_id, target_node_id, relation_id, edge_type,
              label, content_json, style_json, created_at, updated_at
       FROM literature_canvas_edges
       WHERE canvas_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
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
         WHERE id = ANY($1::uuid[])`,
        [paperIds]
      );
      papers = r.rows;
    }

    res.json({
      canvas: c.rows[0],
      nodes: nodes.rows,
      edges: edges.rows,
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

    let relationId = null;

    if (edge_type === 'paper_relation') {
      const validTypes = ['cites', 'extends', 'contradicts', 'supports', 'related', 'method', 'dataset'];
      if (!relation_type || !validTypes.includes(relation_type)) {
        return res.status(400).json({ error: 'valid relation_type required for paper_relation edges' });
      }
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
        edge_type,
        label || null,
        JSON.stringify(content_json || {}),
        JSON.stringify(style_json || {}),
      ]
    );
    res.status(201).json(r.rows[0]);
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

    // Skip papers already on the canvas
    const existing = await db.query(
      `SELECT ref_id FROM literature_canvas_nodes
       WHERE canvas_id = $1 AND ref_type = 'paper' AND ref_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [canvasId, paperIds]
    );
    const existingSet = new Set(existing.rows.map((r) => r.ref_id));
    const toCreate = paperIds.filter((id) => !existingSet.has(id));
    if (toCreate.length === 0) {
      return res.json({ created: [], skipped: paperIds });
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
