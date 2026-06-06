const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET /api/literature/papers/:paperId/annotations?page=N
router.get('/:paperId/annotations', async (req, res) => {
  try {
    const { paperId } = req.params;
    const { page } = req.query;

    let query = `SELECT * FROM paper_annotations
                 WHERE paper_id = $1 AND deleted_at IS NULL
                 AND created_by_user_id = $2`;
    const params = [paperId, req.user.id];

    if (page !== undefined) {
      const pageNum = parseInt(page, 10);
      if (!isNaN(pageNum)) {
        query += ` AND page_number = $3`;
        params.push(pageNum);
      }
    }

    query += ` ORDER BY page_number, created_at`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List paper annotations error:', err);
    res.status(500).json({ error: 'Failed to list annotations' });
  }
});

// POST /api/literature/papers/:paperId/annotations
router.post('/:paperId/annotations', async (req, res) => {
  try {
    const { paperId } = req.params;
    const { page_number, annotation_type, geometry_json, style_json, text_content } = req.body;

    if (page_number === undefined || !annotation_type) {
      return res.status(400).json({ error: 'page_number and annotation_type are required' });
    }

    const validTypes = ['highlight', 'ink', 'underline'];
    if (!validTypes.includes(annotation_type)) {
      return res.status(400).json({ error: `annotation_type must be one of: ${validTypes.join(', ')}` });
    }

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO paper_annotations
       (id, paper_id, page_number, annotation_type, geometry_json, style_json, text_content, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id, paperId, page_number, annotation_type,
        JSON.stringify(geometry_json || {}),
        JSON.stringify(style_json || {}),
        text_content || null,
        req.user.id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create paper annotation error:', err);
    res.status(500).json({ error: 'Failed to create annotation' });
  }
});

// PATCH /api/literature/papers/annotations/:annotationId
router.patch('/annotations/:annotationId', async (req, res) => {
  try {
    const { annotationId } = req.params;
    const { geometry_json, style_json, text_content } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (geometry_json !== undefined) { fields.push(`geometry_json = $${idx++}`); values.push(JSON.stringify(geometry_json)); }
    if (style_json !== undefined) { fields.push(`style_json = $${idx++}`); values.push(JSON.stringify(style_json)); }
    if (text_content !== undefined) { fields.push(`text_content = $${idx++}`); values.push(text_content); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    values.push(annotationId);
    values.push(req.user.id);

    const result = await db.query(
      `UPDATE paper_annotations SET ${fields.join(', ')}
       WHERE id = $${idx} AND created_by_user_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found or not owned by user' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update paper annotation error:', err);
    res.status(500).json({ error: 'Failed to update annotation' });
  }
});

// DELETE /api/literature/papers/annotations/:annotationId (soft delete)
router.delete('/annotations/:annotationId', async (req, res) => {
  try {
    const { annotationId } = req.params;

    const result = await db.query(
      `UPDATE paper_annotations SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND created_by_user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [annotationId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found or not owned by user' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete paper annotation error:', err);
    res.status(500).json({ error: 'Failed to delete annotation' });
  }
});

module.exports = router;
