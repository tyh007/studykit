const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// GET /api/literature/custom-fields?projectId=xxx
router.get('/', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) return res.json([]);

    const result = await db.query(
      `SELECT id, project_id, workspace_id, name, description, prompt, created_at
       FROM literature_custom_fields
       WHERE workspace_id = $1 AND project_id = $2 AND deleted_at IS NULL
       ORDER BY created_at`,
      [ws.rows[0].id, projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List custom fields error:', err);
    res.status(500).json({ error: 'Failed to list custom fields' });
  }
});

// POST /api/literature/custom-fields
router.post('/', async (req, res) => {
  try {
    const { project_id, name, description, prompt } = req.body;
    if (!project_id || !name) return res.status(400).json({ error: 'project_id and name are required' });

    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) return res.status(400).json({ error: 'No workspace found' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO literature_custom_fields (id, project_id, workspace_id, name, description, prompt)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, project_id, ws.rows[0].id, name, description || null, prompt || null]
    );

    const result = await db.query('SELECT * FROM literature_custom_fields WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create custom field error:', err);
    res.status(500).json({ error: 'Failed to create custom field' });
  }
});

// PATCH /api/literature/custom-fields/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, prompt } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (prompt !== undefined) { fields.push(`prompt = $${idx++}`); values.push(prompt); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    await db.query(
      `UPDATE literature_custom_fields SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
      values
    );

    const result = await db.query('SELECT * FROM literature_custom_fields WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Custom field not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update custom field error:', err);
    res.status(500).json({ error: 'Failed to update custom field' });
  }
});

// DELETE /api/literature/custom-fields/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'UPDATE literature_custom_fields SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete custom field error:', err);
    res.status(500).json({ error: 'Failed to delete custom field' });
  }
});

module.exports = router;
