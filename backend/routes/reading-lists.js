const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

async function getWorkspaceId(userId) {
  const ws = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  return ws.rows[0]?.id;
}

/**
 * GET /api/reading-lists
 * List reading lists, optionally filtered by module_id
 */
router.get('/', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.json([]);

    const moduleId = req.query.module_id || null;

    let query, params;
    if (moduleId) {
      query = `SELECT * FROM reading_lists WHERE workspace_id = $1 AND module_id = $2 AND deleted_at IS NULL ORDER BY name`;
      params = [workspaceId, moduleId];
    } else {
      query = `SELECT * FROM reading_lists WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY name`;
      params = [workspaceId];
    }

    const result = await db.query(query, params);

    // For each reading list, get item count
    const listsWithCounts = await Promise.all(result.rows.map(async (list) => {
      const countResult = await db.query(
        `SELECT COUNT(*) as item_count FROM reading_list_items WHERE reading_list_id = $1`,
        [list.id]
      );
      return { ...list, item_count: parseInt(countResult.rows[0].item_count) };
    }));

    res.json(listsWithCounts);
  } catch (err) {
    console.error('List reading lists error:', err);
    res.status(500).json({ error: 'Failed to list reading lists' });
  }
});

/**
 * GET /api/reading-lists/:id
 * Get a single reading list with its items
 */
router.get('/:id', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(404).json({ error: 'Workspace not found' });

    const listResult = await db.query(
      `SELECT * FROM reading_lists WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [req.params.id, workspaceId]
    );

    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reading list not found' });
    }

    const itemsResult = await db.query(
      `SELECT rli.id as item_id, rli.sort_order, rli.notes,
              ci.id, ci.title, ci.creators_json, ci.issued_year, ci.item_type,
              ci.doi, ci.url, ci.publisher, ci.csl_json, ci.citekey
       FROM reading_list_items rli
       JOIN citation_items ci ON ci.id = rli.citation_item_id AND ci.deleted_at IS NULL
       WHERE rli.reading_list_id = $1
       ORDER BY rli.sort_order, ci.title`,
      [req.params.id]
    );

    res.json({
      ...listResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (err) {
    console.error('Get reading list error:', err);
    res.status(500).json({ error: 'Failed to get reading list' });
  }
});

/**
 * POST /api/reading-lists
 * Create a new reading list
 */
router.post('/', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const { name, description, module_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO reading_lists (id, workspace_id, module_id, name, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, workspaceId, module_id || null, name, description || null]
    );

    res.status(201).json({ ...result.rows[0], item_count: 0 });
  } catch (err) {
    console.error('Create reading list error:', err);
    res.status(500).json({ error: 'Failed to create reading list' });
  }
});

/**
 * PATCH /api/reading-lists/:id
 * Update a reading list
 */
router.patch('/:id', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const { name, description } = req.body;
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIdx++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIdx++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id, workspaceId);
    const result = await db.query(
      `UPDATE reading_lists SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIdx++} AND workspace_id = $${paramIdx} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reading list not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update reading list error:', err);
    res.status(500).json({ error: 'Failed to update reading list' });
  }
});

/**
 * DELETE /api/reading-lists/:id
 * Soft delete a reading list
 */
router.delete('/:id', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const result = await db.query(
      `UPDATE reading_lists SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reading list not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete reading list error:', err);
    res.status(500).json({ error: 'Failed to delete reading list' });
  }
});

/**
 * POST /api/reading-lists/:id/items
 * Add a citation item to a reading list
 */
router.post('/:id/items', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const { citation_item_id } = req.body;
    if (!citation_item_id) {
      return res.status(400).json({ error: 'citation_item_id is required' });
    }

    // Verify reading list belongs to user
    const listResult = await db.query(
      `SELECT id FROM reading_lists WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [req.params.id, workspaceId]
    );
    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reading list not found' });
    }

    // Check if already exists
    const existing = await db.query(
      `SELECT id FROM reading_list_items WHERE reading_list_id = $1 AND citation_item_id = $2`,
      [req.params.id, citation_item_id]
    );
    if (existing.rows.length > 0) {
      return res.json({ success: true, item: existing.rows[0] });
    }

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO reading_list_items (id, reading_list_id, citation_item_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.params.id, citation_item_id]
    );

    res.status(201).json({ success: true, item: result.rows[0] });
  } catch (err) {
    console.error('Add reading list item error:', err);
    res.status(500).json({ error: 'Failed to add item to reading list' });
  }
});

/**
 * DELETE /api/reading-lists/:id/items/:itemId
 * Remove a citation item from a reading list
 */
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const result = await db.query(
      `DELETE FROM reading_list_items
       WHERE id = $1 AND reading_list_id = $2
       RETURNING id`,
      [req.params.itemId, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found in reading list' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Remove reading list item error:', err);
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

module.exports = router;
