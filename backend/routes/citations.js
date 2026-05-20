const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// Helper: get workspace ID for the current user
async function getWorkspaceId(userId) {
  const ws = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  return ws.rows[0]?.id;
}

/**
 * GET /api/citations
 * List citation items with optional search
 */
router.get('/', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.json([]);

    const search = req.query.search || '';

    if (search) {
      const result = await db.query(
        `SELECT id, workspace_id, provider, citekey, title, creators_json,
                issued_year, item_type, publisher, doi, url, abstract,
                tags_json, csl_json, bibtex, created_at, updated_at
         FROM citation_items
         WHERE workspace_id = $1
           AND deleted_at IS NULL
           AND (title ILIKE $2 OR abstract ILIKE $2)
         ORDER BY issued_year DESC NULLS LAST, title
         LIMIT 50`,
        [workspaceId, `%${search}%`]
      );
      return res.json(result.rows);
    }

    const result = await db.query(
      `SELECT id, workspace_id, provider, citekey, title, creators_json,
              issued_year, item_type, publisher, doi, url, abstract,
              tags_json, csl_json, bibtex, created_at, updated_at
       FROM citation_items
       WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY issued_year DESC NULLS LAST, title
       LIMIT 200`,
      [workspaceId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List citations error:', err);
    res.status(500).json({ error: 'Failed to list citations' });
  }
});

/**
 * GET /api/citations/:id
 * Get a single citation item
 */
router.get('/:id', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(404).json({ error: 'Workspace not found' });

    const result = await db.query(
      `SELECT id, workspace_id, provider, citekey, title, creators_json,
              issued_year, item_type, publisher, doi, url, abstract,
              tags_json, csl_json, bibtex, created_at, updated_at
       FROM citation_items
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [req.params.id, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Citation not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get citation error:', err);
    res.status(500).json({ error: 'Failed to get citation' });
  }
});

/**
 * POST /api/citations
 * Create a manual citation item
 */
router.post('/', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const { title, creators_json, issued_year, item_type, publisher, doi, url, abstract } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO citation_items
       (id, workspace_id, provider, title, creators_json, issued_year,
        item_type, publisher, doi, url, abstract)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, workspace_id, provider, citekey, title, creators_json,
                 issued_year, item_type, publisher, doi, url, abstract,
                 tags_json, csl_json, bibtex, created_at, updated_at`,
      [
        id,
        workspaceId,
        title,
        JSON.stringify(creators_json || []),
        issued_year || null,
        item_type || 'document',
        publisher || null,
        doi || null,
        url || null,
        abstract || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create citation error:', err);
    res.status(500).json({ error: 'Failed to create citation' });
  }
});

/**
 * DELETE /api/citations/:id
 * Soft delete a citation item
 */
router.delete('/:id', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    if (!workspaceId) return res.status(400).json({ error: 'Workspace not found' });

    const result = await db.query(
      `UPDATE citation_items
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Citation not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete citation error:', err);
    res.status(500).json({ error: 'Failed to delete citation' });
  }
});

module.exports = router;
