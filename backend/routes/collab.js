/**
 * StudyKit v0.4 — `backend/routes/collab`
 *
 * The Collaboration Foundation HTTP API
 * (WP-08 Round 3). The collab slice is
 * server-authoritative: membership,
 * activity, and the cross-user op log
 * live in Postgres. The client never reads
 * or writes these tables directly; it
 * always goes through this router.
 *
 * Contract surface
 * ---------------
 *
 *   GET    /api/collab/projects
 *     Lists the projects the caller is a
 *     member of. The response includes
 *     minimal metadata (name, kind, owner,
 *     role) so the client can render the
 *     Research Home project list.
 *
 *   POST   /api/collab/projects
 *     Body: { id, name, kind, owner_user_id }
 *     Creates a project + the creator's
 *     `owner` membership row in one
 *     transaction. The caller MUST be the
 *     `owner_user_id`; the server checks
 *     `req.user.id === owner_user_id`. The
 *     `id` is the client-generated project
 *     id; the server enforces the (id,
 *     workspace_id) uniqueness.
 *
 *   POST   /api/collab/projects/:id/memberships
 *     Body: { user_id, role, display_name }
 *     Invites a user to a project. Only the
 *     project's `owner` may invite. The
 *     (project_id, user_id) pair is unique;
 *     a duplicate invite is a 200 OK no-op
 *     (the existing row is returned). The
 *     role MUST be one of
 *     `editor|commenter|viewer` — the
 *     `owner` role is reserved for the
 *     atomic create-time assignment.
 *
 *   GET    /api/collab/projects/:id/memberships
 *     Lists the project's members. The
 *     caller MUST be a member. Non-members
 *     get 403.
 *
 *   GET    /api/collab/projects/:id/activities?since=...
 *     Returns the cross-user activity feed.
 *     Pagination is `(created_at, id) > since`
 *     (the client passes the `cursor` string
 *     the server returned on the previous
 *     pull; the server splits the cursor on
 *     `:` to get the millisecond + id
 *     pair).
 *
 *   POST   /api/collab/projects/:id/activities
 *     Body: { id, actor_name, actor_type,
 *             kind, target_kind, target_id,
 *             summary, body, payload_json }
 *     Appends a single activity row. The
 *     client uses this to publish a
 *     cross-user event (member-added,
 *     comment-posted, task-shared, etc.)
 *     atomically with the canonical write.
 *     The (id) is the client-generated op
 *     id; the server enforces uniqueness.
 *
 *   POST   /api/collab/projects/:id/push
 *     Body: { client_id, ops: CollabOp[] }
 *     Pushes a batch of ops to the server-side
 *     op log. Idempotent on (client_id, id):
 *     a re-sent op is a no-op. The server
 *     inserts each op in a transaction and
 *     returns `{ accepted: string[],
 *     rejected: { id, reason }[] }`. The
 *     client uses the response to mark its
 *     outbox rows `syncedAt`.
 *
 *   GET    /api/collab/projects/:id/pull?client_id=...&since=...
 *     Returns the project's op log since
 *     the caller's cursor. Self-writes
 *     (ops with `client_id === self`) are
 *     filtered out. The response cursor is
 *     `<ms>:<id>` of the most recent
 *     returned op (or the caller's `since`
 *     if no ops were returned).
 *
 * Authorization
 * -------------
 *
 * Every endpoint requires a valid JWT
 * (`authenticateToken`). The caller is
 * `req.user`. Membership / project
 * authorization is enforced per endpoint:
 * a non-member calling a project-scoped
 * endpoint gets 403. The server never trusts
 * `role`, `actorId`, or `projectId` from
 * the request body — it looks them up from
 * the database using `req.user.id`.
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set(['owner', 'editor', 'commenter', 'viewer']);
const INVITABLE_ROLES = new Set(['editor', 'commenter', 'viewer']);
// v0.5 P4b: shared project AI threads (ADR-003 §5). Only owners and
// editors post; commenters and viewers read them through pull.
const AI_THREAD_OPS = ['ai-thread-created', 'ai-thread-updated', 'ai-message-appended', 'ai-draft-decided'];
const AI_OP_MAX_BYTES = 256 * 1024;

/**
 * The shared thread `threadId` in `projectId`, as first published, or
 * null. A thread exists on the server only once an `ai-thread-created`
 * op for it was accepted; private threads are never pushed.
 */
async function findSharedThread(projectId, threadId) {
  const result = await db.query(
    "SELECT payload_json FROM collab_op_log WHERE project_id = $1 AND kind = 'ai-thread-created'",
    [projectId],
  );
  for (const row of result.rows) {
    try {
      const t = JSON.parse(row.payload_json);
      if (t && t.id === threadId) return t;
    } catch {
      /* ignore malformed rows */
    }
  }
  return null;
}

/**
 * Validate an AI thread op against the caller. Returns a rejection
 * reason, or null when the op may be stored. AI never posts as itself
 * or as someone else: every record names the member who wrote or
 * requested it, and that must be the caller.
 */
async function checkAiThreadOp(kind, parsed, rawPayload, projectId, userId) {
  if (Buffer.byteLength(rawPayload, 'utf8') > AI_OP_MAX_BYTES) return 'payload exceeds 256 KiB';
  if (!parsed || typeof parsed !== 'object') return 'invalid payload';
  if (parsed.projectId !== projectId) return 'payload projectId mismatch';
  switch (kind) {
    case 'ai-thread-created':
    case 'ai-thread-updated': {
      if (typeof parsed.id !== 'string' || !parsed.id) return 'thread id missing';
      if (parsed.visibility !== 'shared') return 'only shared threads are synced';
      const existing = await findSharedThread(projectId, parsed.id);
      if (kind === 'ai-thread-created') {
        if (parsed.createdBy !== userId) return 'thread creator mismatch';
        if (existing && existing.createdBy !== userId) return 'thread id already taken';
        return null;
      }
      if (!existing) return 'unknown thread';
      if (parsed.createdBy !== existing.createdBy) return 'thread creator cannot change';
      return null;
    }
    case 'ai-message-appended': {
      if (parsed.authorId !== userId) return 'message author mismatch';
      if (parsed.role !== 'user' && parsed.role !== 'assistant') return 'invalid message role';
      if (!(await findSharedThread(projectId, parsed.threadId))) return 'thread is not shared in this project';
      return null;
    }
    case 'ai-draft-decided': {
      if (parsed.decidedBy !== userId) return 'decision author mismatch';
      if (parsed.decision !== 'applied' && parsed.decision !== 'rejected') return 'invalid decision';
      if (!(await findSharedThread(projectId, parsed.threadId))) return 'thread is not shared in this project';
      return null;
    }
    default:
      return 'unknown AI op';
  }
}

const ROLE_ALLOWED_OPS = {
  owner: new Set([
    'member-added', 'member-role-changed', 'member-removed',
    'comment-posted', 'comment-resolved', 'activity-logged',
    'task-shared', 'task-assigned', 'task-status-changed',
    'conflict-detected',
    ...AI_THREAD_OPS,
  ]),
  editor: new Set([
    'comment-posted', 'comment-resolved', 'activity-logged',
    'task-shared', 'task-assigned', 'task-status-changed',
    'conflict-detected',
    ...AI_THREAD_OPS,
  ]),
  commenter: new Set(['comment-posted', 'activity-logged']),
  viewer: new Set(),
};

/**
 * Verify the caller is a member of `projectId`.
 * Returns the membership row on success; throws
 * a tagged error (`{ status, code }`) on
 * failure. The error is caught by the route and
 * turned into a JSON response.
 */
async function requireMembership(req, projectId) {
  const result = await db.query(
    'SELECT project_id, user_id, role, display_name FROM collab_memberships WHERE project_id = $1 AND user_id = $2',
    [projectId, req.user.id],
  );
  if (result.rows.length === 0) {
    const e = new Error('forbidden');
    e.status = 403;
    e.code = 'NOT_A_MEMBER';
    throw e;
  }
  return result.rows[0];
}

/**
 * Require the caller has the `owner` role on
 * `projectId`. Throws 403 on failure.
 */
async function requireOwner(req, projectId) {
  const membership = await requireMembership(req, projectId);
  if (membership.role !== 'owner') {
    const e = new Error('forbidden');
    e.status = 403;
    e.code = 'NOT_OWNER';
    throw e;
  }
  return membership;
}

/**
 * Convert a tagged error to a JSON response.
 * The `asyncHandler` wrapper calls this.
 */
function sendError(res, err) {
  if (err.status === 403) {
    return res.status(403).json({ error: err.message, code: err.code });
  }
  if (err.status === 400) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err.status === 404) {
    return res.status(404).json({ error: err.message, code: err.code });
  }
  if (err.status === 409) {
    return res.status(409).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: 'Internal server error' });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error('collab route error:', err);
      if (err.status) return sendError(res, err);
      return res.status(500).json({ error: 'Internal server error' });
    });
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// GET /api/collab/projects — list projects the caller is a member of.
router.get('/projects', asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT p.id, p.workspace_id, p.name, p.kind, p.owner_user_id,
            p.created_at, p.updated_at,
            m.role
       FROM collab_projects p
       JOIN collab_memberships m
         ON m.project_id = p.id
        AND m.user_id = $1
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC`,
    [req.user.id],
  );
  res.json({ projects: result.rows });
}));

// POST /api/collab/projects — atomic create + owner membership.
// The caller MUST be `req.user.id`. The server
// uses a single transaction; either both rows
// commit or neither does.
router.post('/projects', asyncHandler(async (req, res) => {
  const { id, name, kind, owner_user_id } = req.body;
  if (!id || !name || !kind || !owner_user_id) {
    return res.status(400).json({ error: 'id, name, kind, owner_user_id are required' });
  }
  if (owner_user_id !== req.user.id) {
    return res.status(403).json({ error: 'owner_user_id must match the authenticated user', code: 'OWNER_MISMATCH' });
  }
  if (name.length > 200) {
    return res.status(400).json({ error: 'name is too long' });
  }

  // The caller's workspace is the auto-bound
  // workspace (every user has exactly one
  // non-deleted workspace per the existing
  // auth model).
  const ws = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [req.user.id],
  );
  if (ws.rows.length === 0) {
    return res.status(400).json({ error: 'no workspace for user' });
  }
  const workspaceId = ws.rows[0].id;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // Idempotent: if a project with this id
    // already exists, return it. The server
    // treats (id) as the source of truth (the
    // id is the client-generated project id).
    const existing = await client.query(
      'SELECT id, workspace_id, name, kind, owner_user_id, created_at, updated_at FROM collab_projects WHERE id = $1',
      [id],
    );
    let project;
    if (existing.rows.length > 0) {
      project = existing.rows[0];
      if (project.owner_user_id !== req.user.id) {
        const e = new Error('project id is already owned by another user');
        e.status = 409;
        e.code = 'PROJECT_ID_CONFLICT';
        throw e;
      }
    } else {
      const inserted = await client.query(
        `INSERT INTO collab_projects (id, workspace_id, name, kind, owner_user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, workspace_id, name, kind, owner_user_id, created_at, updated_at`,
        [id, workspaceId, name, kind, req.user.id],
      );
      project = inserted.rows[0];
    }
    // Atomic owner membership. ON CONFLICT
    // DO NOTHING so a re-create is a no-op.
    // `role` and `added_by` are explicit
    // parameters so the caller-claim surface
    // stays uniform (and the mock DB stays
    // trivial).
    await client.query(
      `INSERT INTO collab_memberships (project_id, user_id, role, added_by, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [id, req.user.id, 'owner', req.user.id, req.user.display_name || req.user.email || 'Owner'],
    );
    await client.query('COMMIT');
    res.status(existing.rows.length > 0 ? 200 : 201).json({ project });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

// POST /api/collab/projects/:id/memberships — invite a user.
// Only the project's `owner` may invite. The
// role is constrained to a non-owner value
// (the `owner` role is reserved for the
// atomic create-time assignment). A duplicate
// (project, user) is a no-op 200 OK.
router.post('/projects/:id/memberships', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireOwner(req, projectId);
  const { user_id, role, display_name } = req.body;
  if (!user_id || !role || !display_name) {
    return res.status(400).json({ error: 'user_id, role, display_name are required' });
  }
  if (!INVITABLE_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of ${Array.from(INVITABLE_ROLES).join('|')}`, code: 'INVALID_ROLE' });
  }
  // The invitee must exist. (We don't require
  // a registration step in v0.4 Beta; the
  // server creates the user on register. If
  // the user does not exist, the FK fails.)
  const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [user_id]);
  if (userCheck.rows.length === 0) {
    return res.status(400).json({ error: 'user_id does not exist', code: 'USER_NOT_FOUND' });
  }
  // Idempotent: ON CONFLICT DO NOTHING + read
  // back. We use the (project_id, user_id)
  // primary key as the conflict target.
  const inserted = await db.query(
    `INSERT INTO collab_memberships (project_id, user_id, role, added_by, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, user_id) DO NOTHING
     RETURNING project_id, user_id, role, display_name, added_at`,
    [projectId, user_id, role, req.user.id, display_name],
  );
  let row;
  if (inserted.rows.length > 0) {
    row = inserted.rows[0];
  } else {
    const existing = await db.query(
      'SELECT project_id, user_id, role, display_name, added_at FROM collab_memberships WHERE project_id = $1 AND user_id = $2',
      [projectId, user_id],
    );
    row = existing.rows[0];
  }
  res.json({ membership: row });
}));

// GET /api/collab/projects/:id/memberships — list members.
// Caller MUST be a member. Non-members get 403.
router.get('/projects/:id/memberships', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireMembership(req, projectId);
  const result = await db.query(
    `SELECT project_id, user_id, role, display_name, added_by, added_at
       FROM collab_memberships
      WHERE project_id = $1
      ORDER BY added_at ASC`,
    [projectId],
  );
  res.json({ memberships: result.rows });
}));

// PATCH /api/collab/projects/:id/memberships/:userId
// Owner-only role change. Ownership transfer is
// deliberately out of scope; owner cannot be
// assigned through this endpoint.
router.patch('/projects/:id/memberships/:userId', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireOwner(req, projectId);
  const { role } = req.body;
  if (!INVITABLE_ROLES.has(role)) {
    return res.status(400).json({ error: 'invalid role', code: 'INVALID_ROLE' });
  }
  const updated = await db.query(
    `UPDATE collab_memberships
        SET role = $3
      WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'
      RETURNING project_id, user_id, role, display_name, added_by, added_at`,
    [projectId, req.params.userId, role],
  );
  if (updated.rows.length === 0) {
    return res.status(404).json({ error: 'membership not found or is owner', code: 'MEMBERSHIP_NOT_FOUND' });
  }
  res.json({ membership: updated.rows[0] });
}));

// DELETE /api/collab/projects/:id/memberships/:userId
// Owner-only removal; the project owner cannot be
// removed through this endpoint.
router.delete('/projects/:id/memberships/:userId', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireOwner(req, projectId);
  const removed = await db.query(
    `DELETE FROM collab_memberships
      WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'
      RETURNING user_id`,
    [projectId, req.params.userId],
  );
  if (removed.rows.length === 0) {
    return res.status(404).json({ error: 'membership not found or is owner', code: 'MEMBERSHIP_NOT_FOUND' });
  }
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

// GET /api/collab/projects/:id/activities?since=...
// The cursor is the (createdAtMs, id) pair
// encoded as `<ms>:<id>`; we filter
// `created_at > ms OR (created_at = ms AND id > uuid)`.
// For the common case (cursor == null or
// "0"), we return the latest 200 rows.
router.get('/projects/:id/activities', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireMembership(req, projectId);
  const sinceRaw = typeof req.query.since === 'string' ? req.query.since : '';
  let sinceMs = 0;
  let sinceId = null;
  if (sinceRaw && sinceRaw !== '0') {
    const sep = sinceRaw.indexOf(':');
    if (sep > 0) {
      sinceMs = Number(sinceRaw.slice(0, sep)) || 0;
      const idPart = sinceRaw.slice(sep + 1);
      sinceId = idPart || null;
    }
  }
  const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 500);
  // We use a (created_at, id) cursor via a
  // simple query: `created_at > ms OR
  // (created_at = ms AND id > uuid)`. UUIDs
  // compare lexicographically in Postgres.
  const result = await db.query(
    `SELECT id, project_id, actor_user_id, actor_name, actor_type, kind,
            target_kind, target_id, summary, body, payload_json, created_at
       FROM collab_activities
      WHERE project_id = $1
        AND (
          (CAST(EXTRACT(EPOCH FROM created_at) * 1000 AS BIGINT) > $2)
          OR (CAST(EXTRACT(EPOCH FROM created_at) * 1000 AS BIGINT) = $2 AND ($3::text IS NULL OR id > $3::text))
        )
      ORDER BY created_at ASC, id ASC
      LIMIT $4`,
    [projectId, sinceMs, sinceId, limit],
  );
  const last = result.rows[result.rows.length - 1];
  const cursor = last
    ? `${Date.parse(last.created_at.toISOString ? last.created_at.toISOString() : last.created_at)}:${last.id}`
    : sinceRaw || '0';
  res.json({ activities: result.rows, cursor });
}));

// POST /api/collab/projects/:id/activities
// Append a single activity row. The id is
// the client-generated op id; the server
// enforces uniqueness. The (id) is the
// dedupe key for retries.
router.post('/projects/:id/activities', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireMembership(req, projectId);
  const {
    id, actor_name, actor_type, kind,
    target_kind, target_id, summary, body, payload_json,
  } = req.body;
  if (!id || !actor_name || !actor_type || !kind || !summary || !payload_json) {
    return res.status(400).json({ error: 'id, actor_name, actor_type, kind, summary, payload_json are required' });
  }
  if (actor_type !== 'user') {
    return res.status(400).json({
      error: 'canonical activity must be user-authored',
      code: 'INVALID_ACTOR_TYPE',
    });
  }
  // The actor is always the authenticated
  // user; we never trust an actor_id from
  // the body.
  const inserted = await db.query(
    `INSERT INTO collab_activities
       (id, project_id, actor_user_id, actor_name, actor_type, kind,
        target_kind, target_id, summary, body, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, created_at`,
    [
      id, projectId, req.user.id,
      req.user.display_name || req.user.email || actor_name,
      'user', kind,
      target_kind || null, target_id || null,
      summary, body || '', payload_json,
    ],
  );
  // Whether the row was new or a duplicate,
  // we return 200 OK. The client treats the
  // append as a record-only operation; the
  // real-time visibility comes from the
  // inbox pull.
  res.status(inserted.rows.length > 0 ? 201 : 200).json({
    activity: { id, project_id: projectId },
    created: inserted.rows.length > 0,
  });
}));

// ---------------------------------------------------------------------------
// Op log (cross-device sync)
// ---------------------------------------------------------------------------

// POST /api/collab/projects/:id/push
// Idempotent on (client_id, id). A re-sent
// op is a no-op. The client uses the
// `accepted` list to mark its outbox
// `syncedAt`. The server NEVER trusts the
// op's `actorId` or `role` from the body —
// it uses `req.user.id`.
router.post('/projects/:id/push', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  const membership = await requireMembership(req, projectId);
  const { client_id, ops } = req.body;
  if (!client_id || !Array.isArray(ops)) {
    return res.status(400).json({ error: 'client_id and ops[] are required' });
  }
  const accepted = [];
  const rejected = [];
  for (const op of ops) {
    const opClientId = op && (op.clientId || op.client_id);
    const payload = op && (op.payload || op.payload_json);
    const baseVersion = op && (op.baseVersion ?? op.base_version);
    const createdAt = op && (op.createdAt || op.created_at);
    if (!op || typeof op.id !== 'string' || typeof op.kind !== 'string' || typeof payload !== 'string') {
      rejected.push({ id: op && op.id, reason: 'invalid op shape' });
      continue;
    }
    if (opClientId !== client_id) {
      rejected.push({ id: op.id, reason: 'client_id mismatch' });
      continue;
    }
    if (op.projectId && op.projectId !== projectId) {
      rejected.push({ id: op.id, reason: 'project_id mismatch' });
      continue;
    }
    if (!ROLE_ALLOWED_OPS[membership.role]?.has(op.kind)) {
      rejected.push({ id: op.id, reason: `role ${membership.role} cannot push ${op.kind}` });
      continue;
    }
    try {
      const parsed = JSON.parse(payload);
      if (AI_THREAD_OPS.includes(op.kind)) {
        const reason = await checkAiThreadOp(op.kind, parsed, payload, projectId, req.user.id);
        if (reason) {
          rejected.push({ id: op.id, reason });
          continue;
        }
      }
      if (parsed && typeof parsed === 'object') {
        const payloadProjectId = parsed.projectId || (parsed.task && parsed.task.projectId);
        if (payloadProjectId && payloadProjectId !== projectId) {
          rejected.push({ id: op.id, reason: 'payload projectId mismatch' });
          continue;
        }
        if (op.kind === 'comment-posted' && parsed.authorId !== req.user.id) {
          rejected.push({ id: op.id, reason: 'comment author mismatch' });
          continue;
        }
        if (op.kind === 'task-assigned' && parsed.assignee?.userId) {
          const assignee = await db.query(
            'SELECT project_id, user_id, role, display_name FROM collab_memberships WHERE project_id = $1 AND user_id = $2',
            [projectId, parsed.assignee.userId],
          );
          if (assignee.rows.length === 0) {
            rejected.push({ id: op.id, reason: 'assignee is not a project member' });
            continue;
          }
        }
      }
    } catch {
      rejected.push({ id: op.id, reason: 'payload is not valid JSON' });
      continue;
    }
    try {
      const result = await db.query(
        `INSERT INTO collab_op_log (id, project_id, client_id, kind, payload_json, base_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (client_id, id) DO NOTHING
         RETURNING id, created_at`,
        [op.id, projectId, client_id, op.kind, payload, baseVersion || null, createdAt || null],
      );
      accepted.push(op.id);
    } catch (err) {
      rejected.push({ id: op.id, reason: err.message || 'insert failed' });
    }
  }
  res.json({ accepted, rejected });
}));

// GET /api/collab/projects/:id/pull?client_id=...&since=...
// Returns ops since the caller's cursor.
// Self-writes (ops with client_id === self)
// are filtered out so a client never
// re-applies its own writes.
router.get('/projects/:id/pull', asyncHandler(async (req, res) => {
  const projectId = req.params.id;
  await requireMembership(req, projectId);
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
  if (!clientId) {
    return res.status(400).json({ error: 'client_id is required' });
  }
  const sinceRaw = typeof req.query.since === 'string' ? req.query.since : '';
  let sinceMs = 0;
  let sinceId = null;
  if (sinceRaw && sinceRaw !== '0') {
    const sep = sinceRaw.indexOf(':');
    if (sep > 0) {
      sinceMs = Number(sinceRaw.slice(0, sep)) || 0;
      const idPart = sinceRaw.slice(sep + 1);
      sinceId = idPart || null;
    }
  }
  const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 500);
  const result = await db.query(
    `SELECT id, project_id, client_id, kind, payload_json, base_version, created_at
       FROM collab_op_log
      WHERE project_id = $1
        AND client_id <> $2
        AND (
          (CAST(EXTRACT(EPOCH FROM created_at) * 1000 AS BIGINT) > $3)
          OR (CAST(EXTRACT(EPOCH FROM created_at) * 1000 AS BIGINT) = $3 AND ($4::text IS NULL OR id > $4::text))
        )
      ORDER BY created_at ASC, id ASC
      LIMIT $5`,
    [projectId, clientId, sinceMs, sinceId, limit],
  );
  const last = result.rows[result.rows.length - 1];
  const cursor = last
    ? `${Date.parse(last.created_at.toISOString ? last.created_at.toISOString() : last.created_at)}:${last.id}`
    : sinceRaw || '0';
  res.json({
    ops: result.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      projectId: row.project_id,
      kind: row.kind,
      payload: row.payload_json,
      ...(row.base_version !== null && row.base_version !== undefined
        ? { baseVersion: row.base_version }
        : {}),
      createdAt: row.created_at.toISOString
        ? row.created_at.toISOString()
        : row.created_at,
    })),
    cursor,
  });
}));

module.exports = router;
