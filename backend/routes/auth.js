const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

// Rate limiting for auth endpoints (prevent brute force attacks)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again after 15 minutes.' },
});

// Apply rate limiter to all auth routes
router.use(authLimiter);

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, display_name } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Password must not exceed 128 characters' });
    }

    // Sanitize display_name
    const sanitizedName = display_name
      ? display_name.replace(/[<>&"']/g, '').trim().substring(0, 100)
      : email.split('@')[0];

    // Check existing user
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = uuidv4();
    const password_hash = await auth.hashPassword(password);

    await db.query(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
      [id, email.toLowerCase(), password_hash, sanitizedName]
    );

    // Create default workspace
    const workspaceId = uuidv4();
    await db.query(
      'INSERT INTO workspaces (id, owner_user_id, name, settings_json) VALUES ($1, $2, $3, $4)',
      [workspaceId, id, 'My StudyKit', JSON.stringify({
        theme: 'system',
        default_cornell_mode: false,
        default_export_template: 'slide_left_notes_right'
      })]
    );

    const user = { id, email: email.toLowerCase(), display_name: sanitizedName };
    const token = auth.signToken(user);

    res.status(201).json({ user, token, workspace_id: workspaceId });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await auth.verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get workspace
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [user.id]
    );

    const token = auth.signToken({ id: user.id, email: user.email });
    res.json({
      user: { id: user.id, email: user.email, display_name: user.display_name },
      token,
      workspace_id: ws.rows[0]?.id
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', auth.authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
