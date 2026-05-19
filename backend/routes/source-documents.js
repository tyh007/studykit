const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

// POST /api/source-documents/upload — upload PDF to a lecture
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { lecture_id } = req.body;

    if (!lecture_id) {
      // Clean up uploaded file
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'lecture_id is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const docId = uuidv4();
    const storageKey = file.filename;

    // Create source document record
    await db.query(
      `INSERT INTO source_documents (id, lecture_id, type, original_filename, storage_key, mime_type, file_size_bytes, processing_status)
       VALUES ($1, $2, 'pdf', $3, $4, $5, $6, 'pending')`,
      [docId, lecture_id, file.originalname, storageKey, 'application/pdf', file.size]
    );

    // Set as active source for the lecture
    await db.query(
      'UPDATE lectures SET active_source_document_id = $1 WHERE id = $2',
      [docId, lecture_id]
    );

    // Start async processing (extract pages)
    processPDFPages(docId, storageKey).catch(err => {
      console.error('PDF processing failed:', err);
    });

    res.status(201).json({
      id: docId,
      lecture_id,
      original_filename: file.originalname,
      storage_key: storageKey,
      file_size_bytes: file.size,
      processing_status: 'pending',
    });
  } catch (err) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /api/source-documents/:id — get document info
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM source_documents WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get document error:', err);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// GET /api/source-documents/:id/pages — get page list
router.get('/:id/pages', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, page_number, width, height, thumbnail_storage_key FROM source_pages WHERE source_document_id = $1 ORDER BY page_number',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get pages error:', err);
    res.status(500).json({ error: 'Failed to get pages' });
  }
});

// POST /api/source-documents/:id/process — trigger re-processing
router.post('/:id/process', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, storage_key FROM source_documents WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = result.rows[0];
    await db.query(
      'UPDATE source_documents SET processing_status = $1 WHERE id = $2',
      ['processing', doc.id]
    );

    // Process without awaiting — return immediately
    processPDFPages(doc.id, doc.storage_key).catch(err => {
      console.error('Re-processing failed:', err);
    });

    res.json({ status: 'processing' });
  } catch (err) {
    console.error('Process trigger error:', err);
    res.status(500).json({ error: 'Failed to start processing' });
  }
});

// Helper: Parse PDF and create page records
// Uses PDF.js in a subprocess since sharp doesn't read PDFs
async function processPDFPages(docId, storageKey) {
  try {
    const filePath = path.join(uploadDir, storageKey);

    // Use PDF.js via a simple child_process approach or pdf-parse
    // For Stage One, we use pdf-parse (lightweight, no rendering needed here)
    let pageCount = 0;
    let dimensions = { width: 1280, height: 720 }; // default A4-like

    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      pageCount = data.numpages;

      // Try to get dimensions from first page
      if (data.pages && data.pages[0]) {
        dimensions = {
          width: data.pages[0].width || 1280,
          height: data.pages[0].height || 720,
        };
      }
    } catch (e) {
      console.warn('pdf-parse failed, using defaults:', e.message);
      // Fallback: count pages by reading PDF structure
      pageCount = await countPDFPages(filePath);
    }

    // Create page records
    const pageIds = [];
    for (let i = 1; i <= pageCount; i++) {
      const pageId = uuidv4();
      pageIds.push(pageId);
      await db.query(
        `INSERT INTO source_pages (id, source_document_id, page_number, width, height)
         VALUES ($1, $2, $3, $4, $5)`,
        [pageId, docId, i, dimensions.width, dimensions.height]
      );
    }

    await db.query(
      'UPDATE source_documents SET page_count = $1, processing_status = $2 WHERE id = $3',
      [pageCount, 'ready', docId]
    );

    console.log(`Processed PDF ${storageKey}: ${pageCount} pages`);
  } catch (err) {
    console.error('processPDFPages error:', err);
    await db.query(
      'UPDATE source_documents SET processing_status = $1, processing_error = $2 WHERE id = $3',
      ['failed', err.message, docId]
    );
  }
}

// Fallback: count pages by reading PDF xref table
async function countPDFPages(filePath) {
  const data = fs.readFileSync(filePath, 'utf8').substring(0, 100000);
  const matches = data.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

// Fallback package check — install pdf-parse or add to package.json
try {
  require.resolve('pdf-parse');
} catch (e) {
  console.warn('pdf-parse not installed. PDF processing will use fallback page counting.');
  console.warn('Install with: npm install pdf-parse');
}

module.exports = router;
