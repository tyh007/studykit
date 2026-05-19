const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// GET /api/lectures?module_id=xxx
router.get('/', async (req, res) => {
  try {
    const { module_id } = req.query;
    if (!module_id) {
      return res.status(400).json({ error: 'module_id query parameter is required' });
    }

    const result = await db.query(
      `SELECT l.id, l.module_id, l.title, l.lecture_date, l.week_label, l.sort_order,
              l.active_source_document_id, l.settings_json, l.created_at, l.updated_at,
              sd.original_filename, sd.processing_status
       FROM lectures l
       LEFT JOIN source_documents sd ON sd.id = l.active_source_document_id AND sd.deleted_at IS NULL
       WHERE l.module_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.sort_order, l.created_at`,
      [module_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List lectures error:', err);
    res.status(500).json({ error: 'Failed to list lectures' });
  }
});

// POST /api/lectures
router.post('/', async (req, res) => {
  try {
    const { module_id, title, lecture_date, week_label, sort_order, settings_json } = req.body;

    if (!module_id || !title) {
      return res.status(400).json({ error: 'module_id and title are required' });
    }

    const id = uuidv4();
    const settings = settings_json || {
      cornell_mode: false,
      layout: 'slide_left_notes_right',
      export_defaults: {
        include_cornell_cues: true,
        include_annotations: true,
        include_page_numbers: true,
        template: 'slide_left_notes_right'
      }
    };

    await db.query(
      `INSERT INTO lectures (id, module_id, title, lecture_date, week_label, sort_order, settings_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, module_id, title, lecture_date || null, week_label || null, sort_order ?? 0, JSON.stringify(settings)]
    );

    const result = await db.query('SELECT * FROM lectures WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create lecture error:', err);
    res.status(500).json({ error: 'Failed to create lecture' });
  }
});

// PATCH /api/lectures/:id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, lecture_date, week_label, sort_order, settings_json, module_id, active_source_document_id } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title); }
    if (lecture_date !== undefined) { fields.push(`lecture_date = $${idx++}`); values.push(lecture_date); }
    if (week_label !== undefined) { fields.push(`week_label = $${idx++}`); values.push(week_label); }
    if (sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(sort_order); }
    if (settings_json !== undefined) { fields.push(`settings_json = $${idx++}`); values.push(JSON.stringify(settings_json)); }
    if (active_source_document_id !== undefined) { fields.push(`active_source_document_id = $${idx++}`); values.push(active_source_document_id); }

    // Handle module move — must atomically update note_blocks.module_id too (PRD consistency rule)
    if (module_id !== undefined) {
      fields.push(`module_id = $${idx++}`);
      values.push(module_id);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Update lecture
      await client.query(
        `UPDATE lectures SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
        values
      );

      // If module changed, atomically update all note_blocks.module_id
      if (module_id !== undefined) {
        await client.query(
          'UPDATE note_blocks SET module_id = $1, updated_at = NOW() WHERE lecture_id = $2 AND deleted_at IS NULL',
          [module_id, id]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const result = await db.query('SELECT * FROM lectures WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lecture not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update lecture error:', err);
    res.status(500).json({ error: 'Failed to update lecture' });
  }
});

// DELETE /api/lectures/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE lectures SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete lecture error:', err);
    res.status(500).json({ error: 'Failed to delete lecture' });
  }
});

// POST /api/lectures/:id/restore — restore soft-deleted lecture
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE lectures SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL',
      [id]
    );
    const result = await db.query('SELECT * FROM lectures WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lecture not found or not deleted' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Restore lecture error:', err);
    res.status(500).json({ error: 'Failed to restore lecture' });
  }
});

// DELETE /api/lectures/:id/permanent — permanently delete lecture (hard delete)
router.delete('/:id/permanent', async (req, res) => {
  try {
    const { id } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM note_blocks WHERE lecture_id = $1', [id]);
      await client.query('DELETE FROM source_documents WHERE lecture_id = $1', [id]);
      await client.query('DELETE FROM lectures WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Permanent delete lecture error:', err);
    res.status(500).json({ error: 'Failed to permanently delete lecture' });
  }
});

module.exports = router;
