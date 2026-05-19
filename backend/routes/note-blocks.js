const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/note-blocks?lecture_id=xxx
router.get('/', async (req, res) => {
  try {
    const { lecture_id, source_page_id } = req.query;
    if (!lecture_id) {
      return res.status(400).json({ error: 'lecture_id query parameter is required' });
    }

    let query = `SELECT * FROM note_blocks WHERE lecture_id = $1 AND deleted_at IS NULL`;
    const params = [lecture_id];

    if (source_page_id) {
      query += ` AND linked_source_page_id = $2`;
      params.push(source_page_id);
    }

    query += ` ORDER BY sort_order, created_at`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List note blocks error:', err);
    res.status(500).json({ error: 'Failed to list note blocks' });
  }
});

// POST /api/note-blocks (batch insert for sync)
router.post('/', async (req, res) => {
  try {
    const blocks = Array.isArray(req.body) ? req.body : [req.body];

    // Validate module_id consistency: every block's module_id must match its lecture's module_id
    for (const block of blocks) {
      if (block.lecture_id && block.module_id) {
        const lecResult = await db.query(
          'SELECT module_id FROM lectures WHERE id = $1 AND deleted_at IS NULL',
          [block.lecture_id]
        );
        if (lecResult.rows.length === 0) {
          return res.status(400).json({ error: `Lecture ${block.lecture_id} not found` });
        }
        if (lecResult.rows[0].module_id !== block.module_id) {
          return res.status(400).json({
            error: `note_blocks.module_id (${block.module_id}) must match parent lecture's module_id (${lecResult.rows[0].module_id})`
          });
        }
      }
    }

    const results = [];
    for (const block of blocks) {
      const {
        id, lecture_id, module_id, parent_block_id, linked_source_page_id,
        block_type, content_json, render_json, source_links_json,
        sort_order, created_by_device_id, version,
      } = block;

      if (!id || !lecture_id || !module_id || !block_type) {
        return res.status(400).json({ error: 'id, lecture_id, module_id, and block_type are required' });
      }

      await db.query(
        `INSERT INTO note_blocks (id, lecture_id, module_id, parent_block_id, linked_source_page_id, block_type, content_json, render_json, source_links_json, sort_order, created_by_device_id, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           content_json = EXCLUDED.content_json,
           render_json = EXCLUDED.render_json,
           source_links_json = EXCLUDED.source_links_json,
           sort_order = EXCLUDED.sort_order,
           version = EXCLUDED.version,
           updated_at = NOW()
         WHERE note_blocks.version <= EXCLUDED.version`,
        [
          id, lecture_id, module_id, parent_block_id || null, linked_source_page_id || null,
          block_type, JSON.stringify(content_json || {}), render_json ? JSON.stringify(render_json) : null,
          JSON.stringify(source_links_json || {}), sort_order ?? 0, created_by_device_id, version ?? 1,
        ]
      );

      results.push({ id, status: 'saved' });
    }

    res.status(201).json(results);
  } catch (err) {
    console.error('Save note blocks error:', err);
    res.status(500).json({ error: 'Failed to save note blocks' });
  }
});

// DELETE /api/note-blocks/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'UPDATE note_blocks SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete note block error:', err);
    res.status(500).json({ error: 'Failed to delete note block' });
  }
});

module.exports = router;
