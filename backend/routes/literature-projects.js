const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// GET /api/literature/projects — list all projects for user's workspace
router.get('/', async (req, res) => {
  try {
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) return res.json([]);

    const result = await db.query(
      `SELECT id, workspace_id, name, description, created_at, updated_at
       FROM literature_projects
       WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [ws.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List literature projects error:', err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// POST /api/literature/projects — create project
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) return res.status(400).json({ error: 'No workspace found' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO literature_projects (id, workspace_id, name, description)
       VALUES ($1, $2, $3, $4)`,
      [id, ws.rows[0].id, name, description || null]
    );

    const result = await db.query('SELECT * FROM literature_projects WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create literature project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/literature/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM literature_projects WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get literature project error:', err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// PATCH /api/literature/projects/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    values.push(id);

    await db.query(
      `UPDATE literature_projects SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
      values
    );

    const result = await db.query('SELECT * FROM literature_projects WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update literature project error:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/literature/projects/:id (soft delete + cascade to papers)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE literature_papers SET deleted_at = NOW() WHERE project_id = $1 AND deleted_at IS NULL',
        [id]
      );
      await client.query(
        'UPDATE literature_custom_fields SET deleted_at = NOW() WHERE project_id = $1 AND deleted_at IS NULL',
        [id]
      );
      await client.query(
        'UPDATE literature_projects SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Delete literature project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// POST /api/literature/projects/:id/restore
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE literature_projects SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL',
      [id]
    );
    const result = await db.query('SELECT * FROM literature_projects WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found or not deleted' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Restore literature project error:', err);
    res.status(500).json({ error: 'Failed to restore project' });
  }
});

module.exports = router;
