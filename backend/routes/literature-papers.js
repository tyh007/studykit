const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// GET /api/literature/papers?projectId=xxx&view=library|trash
router.get('/', async (req, res) => {
  try {
    const { projectId, view } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) return res.json([]);

    const inTrash = view === 'trash' ? true : false;

    const result = await db.query(
      `SELECT id, project_id, workspace_id, file_name, file_size, file_type,
              uploaded_at, processed_at, title, authors, year, journal, doi,
              abstract, extracted_data, reading_status, importance, processing_status, error_message,
              in_trash, trashed_at, storage_key, citation_item_id, created_at, updated_at
       FROM literature_papers
       WHERE workspace_id = $1 AND project_id = $2 AND deleted_at IS NULL AND in_trash = $3
       ORDER BY created_at DESC`,
      [ws.rows[0].id, projectId, inTrash]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List literature papers error:', err);
    res.status(500).json({ error: 'Failed to list papers' });
  }
});

// POST /api/literature/papers — create paper
router.post('/', async (req, res) => {
  try {
    const { project_id, file_name, file_size, file_type, title, authors, year, journal, doi, abstract, full_text, extracted_data } = req.body;
    if (!project_id || !file_name) return res.status(400).json({ error: 'project_id and file_name are required' });

    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) return res.status(400).json({ error: 'No workspace found' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO literature_papers (id, project_id, workspace_id, file_name, file_size, file_type,
        title, authors, year, journal, doi, abstract, full_text, extracted_data, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, project_id, ws.rows[0].id, file_name, file_size || 0, file_type || 'application/pdf',
       title || null, authors || null, year || null, journal || null, doi || null,
       abstract || null, full_text || null, extracted_data ? JSON.stringify(extracted_data) : null, 'completed']
    );

    const result = await db.query('SELECT * FROM literature_papers WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create literature paper error:', err);
    res.status(500).json({ error: 'Failed to create paper' });
  }
});

// GET /api/literature/papers/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM literature_papers WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paper not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get literature paper error:', err);
    res.status(500).json({ error: 'Failed to get paper' });
  }
});

// PATCH /api/literature/papers/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, authors, year, journal, doi, abstract, full_text, extracted_data, processing_status, error_message, action, reading_status, importance } = req.body;

    // Handle special actions: moveToTrash, restoreFromTrash
    if (action === 'moveToTrash') {
      await db.query(
        'UPDATE literature_papers SET in_trash = true, trashed_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      const result = await db.query('SELECT * FROM literature_papers WHERE id = $1', [id]);
      return res.json(result.rows[0]);
    }
    if (action === 'restoreFromTrash') {
      await db.query(
        'UPDATE literature_papers SET in_trash = false, trashed_at = NULL, updated_at = NOW() WHERE id = $1',
        [id]
      );
      const result = await db.query('SELECT * FROM literature_papers WHERE id = $1', [id]);
      return res.json(result.rows[0]);
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title); }
    if (authors !== undefined) { fields.push(`authors = $${idx++}`); values.push(authors); }
    if (year !== undefined) { fields.push(`year = $${idx++}`); values.push(year); }
    if (journal !== undefined) { fields.push(`journal = $${idx++}`); values.push(journal); }
    if (doi !== undefined) { fields.push(`doi = $${idx++}`); values.push(doi); }
    if (abstract !== undefined) { fields.push(`abstract = $${idx++}`); values.push(abstract); }
    if (full_text !== undefined) { fields.push(`full_text = $${idx++}`); values.push(full_text); }
    if (extracted_data !== undefined) { fields.push(`extracted_data = $${idx++}`); values.push(JSON.stringify(extracted_data)); }
    if (processing_status !== undefined) { fields.push(`processing_status = $${idx++}`); values.push(processing_status); }
    if (error_message !== undefined) { fields.push(`error_message = $${idx++}`); values.push(error_message); }
    if (reading_status !== undefined) { fields.push(`reading_status = $${idx++}`); values.push(reading_status); }
    if (importance !== undefined) { fields.push(`importance = $${idx++}`); values.push(importance); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    values.push(id);

    await db.query(
      `UPDATE literature_papers SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
      values
    );

    const result = await db.query('SELECT * FROM literature_papers WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paper not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update literature paper error:', err);
    res.status(500).json({ error: 'Failed to update paper' });
  }
});

// DELETE /api/literature/papers/:id (permanent delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM literature_papers WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete literature paper error:', err);
    res.status(500).json({ error: 'Failed to delete paper' });
  }
});

// GET /api/literature/papers/:id/download — stream PDF file
router.get('/:id/download', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT storage_key, file_name, file_type FROM literature_papers WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    const paper = result.rows[0];

    if (!paper.storage_key) {
      return res.status(404).json({ error: 'No PDF file associated with this paper' });
    }

    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
    const filePath = path.join(uploadDir, paper.storage_key);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF file not found on disk' });
    }

    res.setHeader('Content-Type', paper.file_type || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${paper.file_name}"`);

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } catch (err) {
    console.error('Paper download error:', err);
    res.status(500).json({ error: 'Failed to download paper' });
  }
});

module.exports = router;
