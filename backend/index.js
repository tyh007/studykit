const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('./auth');

const authRoutes = require('./routes/auth');
const modulesRoutes = require('./routes/modules');
const lecturesRoutes = require('./routes/lectures');
const sourceDocumentsRoutes = require('./routes/source-documents');
const noteBlocksRoutes = require('./routes/note-blocks');
const syncRoutes = require('./routes/sync');
const exportsRoutes = require('./routes/exports');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== Security Middleware =====

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

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`StudyKit backend running on port ${PORT}`);
});
