const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// WP-08 Round 3: when MOCK_DB=1, swap the
// real `db` module for an in-memory mock.
// The smoke uses this so the same Express
// + auth + routes can run without a live
// Postgres. The mock implements the SQL
// fragments the routes use; unhandled SQL
// throws (so missing coverage surfaces).
//
// The swap MUST run BEFORE `require('./auth')`
// — auth.js captures `db` at module load
// time. If the mock is installed after,
// auth.js still holds the real `db`
// reference and the mock is bypassed.
if (process.env.MOCK_DB === '1') {
  const dbPath = require.resolve('./db');
  const { makeMockDb } = require('./tests/mockDb');
  const mockDb = makeMockDb();
  require.cache[dbPath] = { exports: mockDb, loaded: true, id: dbPath, filename: dbPath };
  // eslint-disable-next-line no-console
  console.log('[backend] MOCK_DB=1: in-memory mock database installed, JWT_SECRET=' + (process.env.JWT_SECRET || '<default>'));
}

const { authenticateToken } = require('./auth');

const authRoutes = require('./routes/auth');
const collabRoutes = require('./routes/collab');
const modulesRoutes = require('./routes/modules');
const lecturesRoutes = require('./routes/lectures');
const sourceDocumentsRoutes = require('./routes/source-documents');
const noteBlocksRoutes = require('./routes/note-blocks');
const syncRoutes = require('./routes/sync');
const exportsRoutes = require('./routes/exports');
const literatureProjectsRoutes = require('./routes/literature-projects');
const literaturePapersRoutes = require('./routes/literature-papers');
const literatureCustomFieldsRoutes = require('./routes/literature-custom-fields');
const paperNotesRoutes = require('./routes/paper-notes');
const paperRelationsRoutes = require('./routes/paper-relations');
const literatureAIRoutes = require('./routes/literature-ai');
const literatureCanvasRoutes = require('./routes/literature-canvas');
const paperAnnotationsRoutes = require('./routes/paper-annotations');
const zoteroRoutes = require('./routes/zotero');
const citationsRoutes = require('./routes/citations');
const readingListsRoutes = require('./routes/reading-lists');
const uploadsRoutes = require('./routes/uploads');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== Security Middleware =====

// The production API is served behind one trusted reverse proxy (nginx/platform edge).
// This lets express-rate-limit identify the original client from X-Forwarded-For.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Helmet sets various HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false, // CSP is handled by nginx in production
  crossOriginEmbedderPolicy: false, // Allow PDF.js and other embedded resources
}));

// CORS — allow multiple origins for cloud deployment (Zeabur, Railway, etc.)
const isProduction = process.env.NODE_ENV === 'production';

// Allow multiple origins: custom domain, Railway auto-domain, Zeabur auto-domain
const allowedOrigins = [];
if (isProduction) {
  if (process.env.CORS_ORIGIN) allowedOrigins.push(process.env.CORS_ORIGIN);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  if (process.env.ZEABUR_DOMAIN) allowedOrigins.push(`https://${process.env.ZEABUR_DOMAIN}`);
  if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);
  // Also allow any .railway.app or .zeabur.app domain
  allowedOrigins.push(/.railway\.app$/);
  allowedOrigins.push(/.zeabur\.app$/);
}

app.use(cors({
  origin: isProduction ? allowedOrigins : true,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

if (isProduction && allowedOrigins.length === 0) {
  console.warn('⚠️  No CORS origins configured — API calls from browsers may be blocked');
}


// Global rate limiting (optional, configurable via env)
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '0');
const maxRequests = parseInt(process.env.RATE_LIMIT_MAX || '0');
if (windowMs > 0 && maxRequests > 0) {
  app.use(rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  }));
}

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));

// Static file serving for uploads
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const exportDir = process.env.EXPORT_DIR || path.join(__dirname, '..', 'exports');
app.use('/uploads', express.static(uploadDir));
app.use('/exports', express.static(exportDir));

// Public routes
app.use('/api/auth', authRoutes);

// WP-08 Round 3: collab API. Every endpoint
// requires a valid JWT (the router enforces
// membership per-endpoint). No client ID is
// trusted for cross-user data.
app.use('/api/collab', authenticateToken, collabRoutes);

// Health check — enhanced for production
app.get('/api/health', async (req, res) => {
  try {
    const db = require('./db');
    await db.query('SELECT 1');
    res.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: 'connected',
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      version: '0.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: 'disconnected',
    });
  }
});

// Protected routes
app.use('/api/modules', authenticateToken, modulesRoutes);
app.use('/api/lectures', authenticateToken, lecturesRoutes);
app.use('/api/source-documents', authenticateToken, sourceDocumentsRoutes);
app.use('/api/note-blocks', authenticateToken, noteBlocksRoutes);
app.use('/api/sync', authenticateToken, syncRoutes);
app.use('/api/exports', authenticateToken, exportsRoutes);
app.use('/api/literature/projects', authenticateToken, literatureProjectsRoutes);
app.use('/api/literature/papers', authenticateToken, paperAnnotationsRoutes);
app.use('/api/literature/papers', authenticateToken, literaturePapersRoutes);
app.use('/api/literature/custom-fields', authenticateToken, literatureCustomFieldsRoutes);
app.use('/api/literature/paper-notes', authenticateToken, paperNotesRoutes);
app.use('/api/literature/paper-relations', authenticateToken, paperRelationsRoutes);
app.use('/api/literature/ai', authenticateToken, literatureAIRoutes);
app.use('/api/literature/canvas', authenticateToken, literatureCanvasRoutes);
app.use('/api/zotero', authenticateToken, zoteroRoutes);
app.use('/api/citations', authenticateToken, citationsRoutes);
app.use('/api/reading-lists', authenticateToken, readingListsRoutes);
app.use('/api/uploads', authenticateToken, uploadsRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`StudyKit backend running on port ${PORT}`);
});
