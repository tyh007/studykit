const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// GET /api/modules — list all modules for user's workspace
router.get('/', async (req, res) => {
  try {
    // Get user's workspace
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) {
      return res.json([]);
    }

    const result = await db.query(
      `SELECT id, workspace_id, title, code, academic_term, colour, sort_order,
              created_at, updated_at
       FROM modules
       WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY sort_order, created_at`,
      [ws.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List modules error:', err);
    res.status(500).json({ error: 'Failed to list modules' });
  }
});

// POST /api/modules — create module
router.post('/', async (req, res) => {
  try {
    const { title, code, academic_term, colour, sort_order } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) {
      return res.status(400).json({ error: 'No workspace found' });
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO modules (id, workspace_id, title, code, academic_term, colour, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ws.rows[0].id, title, code || null, academic_term || null, colour || null, sort_order ?? 0]
    );

    const result = await db.query('SELECT * FROM modules WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create module error:', err);
    res.status(500).json({ error: 'Failed to create module' });
  }
});

// PATCH /api/modules/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, code, academic_term, colour, sort_order } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title); }
    if (code !== undefined) { fields.push(`code = $${idx++}`); values.push(code); }
    if (academic_term !== undefined) { fields.push(`academic_term = $${idx++}`); values.push(academic_term); }
    if (colour !== undefined) { fields.push(`colour = $${idx++}`); values.push(colour); }
    if (sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(sort_order); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    await db.query(
      `UPDATE modules SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
      values
    );

    const result = await db.query('SELECT * FROM modules WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Module not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update module error:', err);
    res.status(500).json({ error: 'Failed to update module' });
  }
});

// DELETE /api/modules/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE modules SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete module error:', err);
    res.status(500).json({ error: 'Failed to delete module' });
  }
});

// POST /api/modules/:id/restore — restore soft-deleted module
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE modules SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL',
      [id]
    );
    const result = await db.query('SELECT * FROM modules WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Module not found or not deleted' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Restore module error:', err);
    res.status(500).json({ error: 'Failed to restore module' });
  }
});

// DELETE /api/modules/:id/permanent — permanently delete module (hard delete)
router.delete('/:id/permanent', async (req, res) => {
  try {
    const { id } = req.params;
    // Also permanently delete associated lectures and note blocks
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM note_blocks WHERE module_id = $1', [id]);
      await client.query('DELETE FROM lectures WHERE module_id = $1', [id]);
      await client.query('DELETE FROM modules WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Permanent delete module error:', err);
    res.status(500).json({ error: 'Failed to permanently delete module' });
  }
});

module.exports = router;
