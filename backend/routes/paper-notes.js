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
 * GET /api/literature/paper-notes?paperId=xxx
 * List notes for a paper
 */
router.get('/', async (req, res) => {
  try {
    const { paperId } = req.query;
    if (!paperId) return res.status(400).json({ error: 'paperId is required' });

    const result = await db.query(
      `SELECT * FROM paper_notes WHERE paper_id = $1 ORDER BY created_at DESC`,
      [paperId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List paper notes error:', err);
    res.status(500).json({ error: 'Failed to list paper notes' });
  }
});

/**
 * POST /api/literature/paper-notes
 * Create a note for a paper
 */
router.post('/', async (req, res) => {
  try {
    const { paper_id, content } = req.body;
    if (!paper_id || !content) return res.status(400).json({ error: 'paper_id and content are required' });

    const wsId = await getWorkspaceId(req.user.id);
    if (!wsId) return res.status(400).json({ error: 'No workspace found' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO paper_notes (id, paper_id, workspace_id, content) VALUES ($1, $2, $3, $4)`,
      [id, paper_id, wsId, content]
    );

    const result = await db.query('SELECT * FROM paper_notes WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create paper note error:', err);
    res.status(500).json({ error: 'Failed to create paper note' });
  }
});

/**
 * PATCH /api/literature/paper-notes/:id
 * Update a note
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    await db.query(
      `UPDATE paper_notes SET content = $1, updated_at = NOW() WHERE id = $2`,
      [content, id]
    );

    const result = await db.query('SELECT * FROM paper_notes WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update paper note error:', err);
    res.status(500).json({ error: 'Failed to update paper note' });
  }
});

/**
 * DELETE /api/literature/paper-notes/:id
 * Delete a note
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM paper_notes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete paper note error:', err);
    res.status(500).json({ error: 'Failed to delete paper note' });
  }
});

module.exports = router;
