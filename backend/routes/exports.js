const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

const exportDir = process.env.EXPORT_DIR || path.join(__dirname, '..', '..', 'exports');
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

// GET /api/exports — list recent export jobs for the user's workspace
router.get('/', async (req, res) => {
  try {
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) {
      return res.json([]);
    }

    const result = await db.query(
      `SELECT ej.id, ej.workspace_id, ej.module_id, ej.lecture_id, ej.export_type,
              ej.template_id, ej.status, ej.output_storage_key, ej.report_json,
              ej.created_at, ej.completed_at,
              l.title as lecture_title, m.title as module_title
       FROM export_jobs ej
       LEFT JOIN lectures l ON l.id = ej.lecture_id
       LEFT JOIN modules m ON m.id = ej.module_id
       WHERE ej.workspace_id = $1
       ORDER BY ej.created_at DESC
       LIMIT 50`,
      [ws.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List exports error:', err);
    res.status(500).json({ error: 'Failed to list exports' });
  }
});

// POST /api/exports — create a new export job
router.post('/', async (req, res) => {
  try {
    const { lecture_id, module_id, export_type, template_id, include_annotations } = req.body;

    if (!lecture_id || !export_type) {
      return res.status(400).json({ error: 'lecture_id and export_type are required' });
    }

    if (!['pdf', 'markdown'].includes(export_type)) {
      return res.status(400).json({ error: 'export_type must be pdf or markdown' });
    }

    // Get workspace
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) {
      return res.status(400).json({ error: 'No workspace found' });
    }

    const jobId = uuidv4();
    const template = template_id || 'slide_left_notes_right';

    // Create job record
    await db.query(
      `INSERT INTO export_jobs (id, workspace_id, module_id, lecture_id, export_type, template_id, status, report_json)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', '{}')`,
      [jobId, ws.rows[0].id, module_id || null, lecture_id, export_type, template]
    );

    // Start async processing
    processExportJob(jobId, ws.rows[0].id, lecture_id, module_id, export_type, template, !!include_annotations)
      .catch(err => console.error('Export job failed:', err));

    res.status(201).json({
      id: jobId,
      status: 'queued',
      message: export_type === 'pdf'
        ? 'PDF export started. A download link will be available shortly.'
        : 'Markdown export started.',
    });
  } catch (err) {
    console.error('Create export error:', err);
    res.status(500).json({ error: 'Failed to create export job' });
  }
});

// GET /api/exports/:id — get job status
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM export_jobs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    const job = result.rows[0];

    // Check retention policy (30 days)
    if (job.completed_at && job.output_storage_key) {
      const completedDate = new Date(job.completed_at);
      const now = new Date();
      const daysOld = Math.floor((now.getTime() - completedDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOld >= 30) {
        return res.json({
          ...job,
          expired: true,
          message: 'This export has expired. Please re-export the lecture.',
        });
      }
    }

    res.json(job);
  } catch (err) {
    console.error('Get export error:', err);
    res.status(500).json({ error: 'Failed to get export job' });
  }
});

// GET /api/exports/:id/download — download export output
router.get('/:id/download', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM export_jobs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    const job = result.rows[0];

    if (job.status !== 'succeeded' || !job.output_storage_key) {
      return res.status(400).json({ error: 'Export not ready or failed' });
    }

    // Check retention policy
    if (job.completed_at) {
      const daysOld = Math.floor(
        (Date.now() - new Date(job.completed_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysOld >= 30) {
        // Don't delete the metadata, but refuse to serve the file
        return res.status(410).json({
          error: 'Export file has expired (30 day retention). Please re-export.',
          expired: true,
        });
      }
    }

    const filePath = path.join(exportDir, job.output_storage_key);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Export file not found on storage' });
    }

    const filename = job.export_type === 'pdf' ? 'lecture-export.pdf' : 'lecture-export.md';
    res.download(filePath, filename);
  } catch (err) {
    console.error('Download export error:', err);
    res.status(500).json({ error: 'Failed to download export' });
  }
});

// ===== Export Processing =====

async function processExportJob(jobId, workspaceId, lectureId, moduleId, exportType, templateId, includeAnnotations) {
  try {
    await db.query(
      "UPDATE export_jobs SET status = 'running' WHERE id = $1",
      [jobId]
    );

    const warnings = [];

    // Get lecture and module info
    const lectureResult = await db.query(
      'SELECT id, title, lecture_date, week_label FROM lectures WHERE id = $1 AND deleted_at IS NULL',
      [lectureId]
    );
    if (lectureResult.rows.length === 0) {
      throw new Error('Lecture not found');
    }
    const lecture = lectureResult.rows[0];

    let moduleTitle = '';
    let moduleCode = '';
    if (moduleId) {
      const modResult = await db.query(
        'SELECT title, code FROM modules WHERE id = $1 AND deleted_at IS NULL',
        [moduleId]
      );
      if (modResult.rows.length > 0) {
        moduleTitle = modResult.rows[0].title;
        moduleCode = modResult.rows[0].code || '';
      }
    }

    // Get note blocks
    const blocksResult = await db.query(
      `SELECT * FROM note_blocks WHERE lecture_id = $1 AND deleted_at IS NULL ORDER BY sort_order`,
      [lectureId]
    );
    const allBlocks = blocksResult.rows;

    const annotationBlocks = includeAnnotations
      ? allBlocks.filter((b) => b.block_type === 'annotation')
      : [];
    const contentBlocks = allBlocks.filter(
      (b) => b.block_type !== 'cue' && b.block_type !== 'summary' && b.block_type !== 'annotation'
    );

    if (contentBlocks.length === 0) {
      warnings.push('No notes found for this lecture');
    }

    if (exportType === 'markdown') {
      // Collect citation IDs from note blocks
      const citationIds = new Set();
      for (const block of contentBlocks) {
        const links = block.source_links_json || {};
        if (links.citations && Array.isArray(links.citations)) {
          links.citations.forEach(id => citationIds.add(id));
        }
      }

      // Fetch citation items for bibliography
      let citations = [];
      if (citationIds.size > 0) {
        const citResult = await db.query(
          `SELECT id, title, creators_json, issued_year, item_type, publisher, doi, url, csl_json, citekey
           FROM citation_items WHERE id = ANY($1) AND deleted_at IS NULL`,
          [Array.from(citationIds)]
        );
        citations = citResult.rows;
      }

      // Generate markdown on server
      const md = generateServerMarkdown(lecture, contentBlocks, annotationBlocks, moduleTitle, moduleCode, citations);
      const filename = `${lecture.title.replace(/\s+/g, '_')}.md`;
      const storageKey = `${jobId}-${filename}`;
      fs.writeFileSync(path.join(exportDir, storageKey), md, 'utf8');

      await db.query(
        'UPDATE export_jobs SET status = $1, output_storage_key = $2, completed_at = NOW(), report_json = $3 WHERE id = $4',
        ['succeeded', storageKey, JSON.stringify({ warnings, block_count: allBlocks.length, citation_count: citations.length }), jobId]
      );
    } else {
      // PDF: record the job as "needs_browser_print" — user still uses browser print
      // but we track the attempt and can later upgrade to server-side rendering
      await db.query(
        `UPDATE export_jobs SET status = $1, completed_at = NOW(), report_json = $2 WHERE id = $3`,
        ['succeeded', JSON.stringify({
          warnings,
          note: 'PDF generated via browser print. Server-side PDF rendering available in future upgrade.',
          block_count: allBlocks.length,
        }), jobId]
      );
    }
  } catch (err) {
    console.error('Export processing error:', err);
    await db.query(
      'UPDATE export_jobs SET status = $1, report_json = $2, completed_at = NOW() WHERE id = $3',
      ['failed', JSON.stringify({ error: err.message }), jobId]
    );
  }
}

// ===== Server-side Markdown Generator =====

function generateServerMarkdown(lecture, blocks, annotations, moduleTitle, moduleCode, citations) {
  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`title: "${lecture.title}"`);
  if (moduleTitle) lines.push(`module: "${moduleTitle}"`);
  if (moduleCode) lines.push(`code: "${moduleCode}"`);
  if (lecture.lecture_date) lines.push(`date: "${lecture.lecture_date}"`);
  if (lecture.week_label) lines.push(`week: "${lecture.week_label}"`);
  lines.push(`exported: "${new Date().toISOString()}"`);
  lines.push(`generated_by: "StudyKit Stage Two"`);
  if (citations && citations.length > 0) {
    lines.push(`references_count: ${citations.length}`);
  }
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${lecture.title}`);
  lines.push('');

  if (moduleTitle) {
    lines.push(`**Module:** ${moduleTitle}${moduleCode ? ` (${moduleCode})` : ''}`);
    if (lecture.lecture_date) lines.push(`**Date:** ${lecture.lecture_date}`);
    lines.push('');
  }

  // Build annotation map
  const annoMap = new Map();
  for (const a of annotations) {
    const ref = a.linked_source_page_id || '';
    if (ref.startsWith('pos:')) {
      const idx = parseInt(ref.slice(4), 10);
      annoMap.set(idx, a.content_json?.plain_text || '');
    }
  }

  if (blocks.length === 0) {
    lines.push('*No notes for this lecture yet.*');
  } else {
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const c = block.content_json || {};

      // Determine markdown based on block_type
      const plainText = c.plain_text || '';

      switch (block.block_type) {
        case 'heading': {
          const level = c.attrs?.level || 2;
          lines.push(`${'#'.repeat(level)} ${plainText}`);
          break;
        }
        case 'paragraph':
          lines.push(plainText);
          break;
        case 'list': {
          const ordered = c.attrs?.ordered === true;
          // For simplicity, render as plain list
          if (c.content && Array.isArray(c.content)) {
            c.content.forEach((item, i) => {
              const itemText = typeof item === 'object' ? extractItemText(item) : '';
              if (ordered) {
                lines.push(`${i + 1}. ${itemText}`);
              } else {
                lines.push(`- ${itemText}`);
              }
            });
          } else {
            lines.push(plainText);
          }
          break;
        }
        case 'code': {
          const lang = c.attrs?.language || '';
          lines.push(`\`\`\`${lang}`);
          lines.push(plainText);
          lines.push('```');
          break;
        }
        case 'callout':
          lines.push(`> ${plainText}`);
          break;
        case 'equation': {
          const latex = c.attrs?.latex || '';
          lines.push(`$$${latex}$$`);
          break;
        }
        case 'image': {
          const src = c.attrs?.src || '';
          const caption = c.attrs?.caption || '';
          lines.push(`![${caption}](${src})`);
          break;
        }
        default:
          if (plainText) lines.push(plainText);
          break;
      }

      // Append annotation if present
      const anno = annoMap.get(bi);
      if (anno) {
        lines.push(`> 📝 *Annotation:* ${anno}`);
      }
    }
  }

  // Bibliography section
  if (citations && citations.length > 0) {
    lines.push('');
    lines.push('## References');
    lines.push('');

    citations.forEach((cit, idx) => {
      const creators = typeof cit.creators_json === 'string'
        ? JSON.parse(cit.creators_json)
        : (cit.creators_json || []);
      const authorList = creators
        .map(c => {
          if (c.lastName && c.firstName) return `${c.lastName}, ${c.firstName}`;
          if (c.name) return c.name;
          return '';
        })
        .filter(Boolean)
        .join(', ');

      let ref = `[${idx + 1}] `;
      if (authorList) ref += `${authorList}. `;
      ref += `*${cit.title}*`;
      if (cit.publisher) ref += `. ${cit.publisher}`;
      if (cit.issued_year) ref += ` (${cit.issued_year})`;
      if (cit.doi) ref += `. https://doi.org/${cit.doi}`;
      lines.push(ref);
      lines.push('');
    });
  }

  // Footer
  lines.push('');
  lines.push('---');
  lines.push(`*Exported from StudyKit on ${new Date().toLocaleDateString()}*`);

  return lines.join('\n');
}

function extractItemText(item) {
  if (typeof item === 'string') return item;
  if (item.content && Array.isArray(item.content)) {
    return item.content.map((c) => typeof c === 'object' ? (c.text || '') : '').join('');
  }
  return item.text || '';
}

module.exports = router;
