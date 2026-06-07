const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /api/literature/paper-relations?paperId=xxx
 * List all relations for a paper (both incoming and outgoing)
 */
router.get('/', async (req, res) => {
  try {
    const { paperId } = req.query;
    if (!paperId) return res.status(400).json({ error: 'paperId is required' });

    const result = await db.query(
      `SELECT pr.id, pr.source_paper_id, pr.target_paper_id, pr.relation_type, pr.description, pr.created_at,
              lp_source.title as source_title, lp_target.title as target_title
       FROM paper_relations pr
       LEFT JOIN literature_papers lp_source ON lp_source.id = pr.source_paper_id
       LEFT JOIN literature_papers lp_target ON lp_target.id = pr.target_paper_id
       WHERE (pr.source_paper_id = $1 OR pr.target_paper_id = $1)
       ORDER BY pr.created_at DESC`,
      [paperId]
    );

    // Map relations to a normalized format with direction
    const relations = result.rows.map(row => {
      const isOutgoing = row.source_paper_id === paperId;
      return {
        id: row.id,
        source_paper_id: row.source_paper_id,
        target_paper_id: row.target_paper_id,
        related_paper_id: isOutgoing ? row.target_paper_id : row.source_paper_id,
        related_title: isOutgoing ? row.target_title : row.source_title,
        relation_type: row.relation_type,
        description: row.description,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        created_at: row.created_at,
      };
    });

    res.json(relations);
  } catch (err) {
    console.error('List paper relations error:', err);
    res.status(500).json({ error: 'Failed to list paper relations' });
  }
});

/**
 * POST /api/literature/paper-relations
 * Create a relation between two papers
 */
router.post('/', async (req, res) => {
  try {
    const { source_paper_id, target_paper_id, relation_type, description } = req.body;
    if (!source_paper_id || !target_paper_id || !relation_type) {
      return res.status(400).json({ error: 'source_paper_id, target_paper_id, and relation_type are required' });
    }

    const validTypes = ['cites', 'extends', 'contradicts', 'supports', 'related', 'method', 'dataset'];
    if (!validTypes.includes(relation_type)) {
      return res.status(400).json({ error: `relation_type must be one of: ${validTypes.join(', ')}` });
    }

    if (source_paper_id === target_paper_id) {
      return res.status(400).json({ error: 'Cannot create a relation between a paper and itself' });
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO paper_relations (id, source_paper_id, target_paper_id, relation_type, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_paper_id, target_paper_id, relation_type) DO UPDATE SET description = EXCLUDED.description`,
      [id, source_paper_id, target_paper_id, relation_type, description || null]
    );

    const result = await db.query('SELECT * FROM paper_relations WHERE id = $1', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create paper relation error:', err);
    res.status(500).json({ error: 'Failed to create paper relation' });
  }
});

/**
 * DELETE /api/literature/paper-relations/:id
 * Delete a relation
 */
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM paper_relations WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete paper relation error:', err);
    res.status(500).json({ error: 'Failed to delete paper relation' });
  }
});

/**
 * GET /api/literature/paper-relations/graph?projectId=xxx
 * Get all relations in a project for graph visualization
 */
router.get('/graph', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    // Get all papers in the project
    const papers = await db.query(
      `SELECT id, title, authors, year FROM literature_papers WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId]
    );

    // Get all relations between papers in this project
    const relations = await db.query(
      `SELECT pr.id, pr.source_paper_id, pr.target_paper_id, pr.relation_type
       FROM paper_relations pr
       WHERE pr.source_paper_id IN (SELECT id FROM literature_papers WHERE project_id = $1 AND deleted_at IS NULL)
          OR pr.target_paper_id IN (SELECT id FROM literature_papers WHERE project_id = $1 AND deleted_at IS NULL)`,
      [projectId]
    );

    res.json({ nodes: papers.rows, edges: relations.rows });
  } catch (err) {
    console.error('Graph query error:', err);
    res.status(500).json({ error: 'Failed to get graph data' });
  }
});

module.exports = router;
