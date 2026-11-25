/**
 * StudyKit v0.4 — `backend/tests/collab.test.js`
 *
 * The collab API is the WP-08 Round 3
 * server-authoritative boundary for
 * cross-user collaboration. The routes
 * are the single source of truth for:
 *   - project metadata (the rows that make
 *     a project visible to its members)
 *   - membership (the (project, user) join
 *     that gates every project-scoped
 *     endpoint)
 *   - activity (the cross-user event log)
 *   - the cross-device op log (the durable
 *     record of every shared write)
 *
 * The tests use a mock `db` so they do not
 * require a live Postgres. The mock is a
 * thin in-memory store that honours the
 * same SQL fragments the routes use (the
 * route code is exercised against the mock
 * without an integration Postgres). A
 * separate integration test (run by the
 * smoke) drives the routes against a real
 * server.
 *
 * The assertions are framed around the
 * Codex Round 3 P0 invariants:
 *   P0-1: the project creator is the only
 *     one who can atomically own the
 *     project; duplicate memberships are
 *     rejected (or idempotent no-ops); a
 *     non-member cannot read or write.
 *   P0-2: the server validates every
 *     caller-claim against the database;
 *     it never trusts role / actor_id /
 *     project_id from the body alone.
 *   P0-4: op log inserts are idempotent on
 *     (client_id, id); cursors are stable
 *     across re-pulls.
 *   P0-6: the activity feed returns the
 *     writer's events to the other members
 *     in order.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Mock the `db` module before requiring the
// routes. The shared `mockDb` factory is
// `backend/tests/mockDb.js`; the smoke and
// the unit tests both use it.
const { makeMockDb } = require('./mockDb');

function makeMockApp() {
  // Build a minimal Express-shaped app that
  // wires `authenticateToken` (a passthrough
  // that sets `req.user` from the test's
  // auth header) and the collab router.
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    // Auth simulation: every test passes a
    // header `x-test-user: <userId>` and
    // `x-test-user-name: <name>`. The mock
    // auth middleware converts this into
    // `req.user` so the real
    // `authenticateToken` is not needed.
    const userId = req.headers['x-test-user'];
    if (!userId) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    req.user = {
      id: userId,
      email: req.headers['x-test-user-email'] || `${userId}@example.test`,
      display_name: req.headers['x-test-user-name'] || userId,
    };
    next();
  });
  return app;
}

function makeHarness() {
  // Replace the `db` module the routes
  // require so the test sees the mock.
  const mockDb = makeMockDb();
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;
  // We register the mock at the right path
  // so the route's `require('../db')` returns
  // it.
  const dbPath = require.resolve('../db');
  require.cache[dbPath] = { exports: mockDb, loaded: true, id: dbPath, filename: dbPath };
  // Also override the path the routes
  // require (one level up).
  const collabPath = require.resolve('../routes/collab');
  delete require.cache[collabPath];
  const router = require('../routes/collab');
  // Clean up require.cache so subsequent
  // tests get fresh routes.
  delete require.cache[collabPath];
  return { mockDb, router };
}

function seedUsers(mockDb, users) {
  for (const u of users) {
    mockDb._tables.users.set(u.id, {
      id: u.id,
      email: u.email || `${u.id}@example.test`,
      display_name: u.display_name || u.id,
    });
  }
}

function seedWorkspace(mockDb, ownerId) {
  const wsId = `ws_${ownerId}`;
  mockDb._tables.workspaces.set(wsId, {
    id: wsId,
    owner_user_id: ownerId,
    name: 'Test',
    settings_json: {},
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  });
  return wsId;
}

// ---------------------------------------------------------------------------
// P0-1: membership
// ---------------------------------------------------------------------------

test('P0-1: POST /projects creates the project + atomic owner membership in one transaction', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [{ id: 'u-a', display_name: 'A' }]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);

  const res = await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a', 'x-test-user-name': 'A' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.project.id, 'p-1');
  assert.equal(res.body.project.owner_user_id, 'u-a');

  // The owner membership row exists.
  const m = mockDb._tables.collab_memberships.get('p-1|u-a');
  assert.ok(m, 'owner membership must exist');
  assert.equal(m.role, 'owner');
  assert.equal(m.added_by, 'u-a');
});

test('P0-1: POST /projects refuses when owner_user_id does not match the caller', async () => {
  const { router } = makeHarness();
  const app = makeMockApp();
  app.use('/api/collab', router);
  const res = await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-other',
  }, { 'x-test-user': 'u-a' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'OWNER_MISMATCH');
});

test('P0-1: POST /projects/:id/memberships allows the owner to invite, but only with a non-owner role', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  // Owner creates the project.
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });

  // Owner invites B as commenter.
  const invite = await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });
  assert.equal(invite.status, 200);
  assert.equal(invite.body.membership.role, 'commenter');
  assert.equal(invite.body.membership.user_id, 'u-b');

  // Owner attempts to grant `owner` — refused.
  const bad = await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'owner', display_name: 'B',
  }, { 'x-test-user': 'u-a' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'INVALID_ROLE');
});

test('P0-1: a duplicate (project, user) invite is idempotent — no second row is created', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });

  // Two invites for the same user with
  // different roles: the second is a no-op
  // (the existing row stays).
  await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });
  const second = await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'editor', display_name: 'B (renamed)',
  }, { 'x-test-user': 'u-a' });
  assert.equal(second.status, 200);
  // The role did NOT change — the (project,
  // user) pair is unique and the second
  // invite is a no-op.
  const row = mockDb._tables.collab_memberships.get('p-1|u-b');
  assert.equal(row.role, 'commenter');
  assert.equal(row.display_name, 'B');
  // The (project, user) pair exists exactly
  // once.
  const dup = Array.from(mockDb._tables.collab_memberships.values()).filter(
    (m) => m.project_id === 'p-1' && m.user_id === 'u-b',
  );
  assert.equal(dup.length, 1);
});

test('P0-1: a non-member cannot list / pull / push / post activity', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-c', display_name: 'C' }, // C is a user, but NOT invited
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });

  // C tries to read members.
  const r1 = await getJson(app, '/api/collab/projects/p-1/memberships', { 'x-test-user': 'u-c' });
  assert.equal(r1.status, 403);
  assert.equal(r1.body.code, 'NOT_A_MEMBER');

  // C tries to pull.
  const r2 = await getJson(app, '/api/collab/projects/p-1/pull?client_id=cli_c', { 'x-test-user': 'u-c' });
  assert.equal(r2.status, 403);

  // C tries to push.
  const r3 = await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_c', ops: [{ id: 'op_x', client_id: 'cli_c', kind: 'comment-posted', payload_json: '{}' }],
  }, { 'x-test-user': 'u-c' });
  assert.equal(r3.status, 403);

  // C tries to post an activity.
  const r4 = await postJson(app, '/api/collab/projects/p-1/activities', {
    id: 'a_x', actor_name: 'C', actor_type: 'user', kind: 'comment-posted',
    summary: 'hi', payload_json: '{}',
  }, { 'x-test-user': 'u-c' });
  assert.equal(r4.status, 403);

  // C cannot list the project either
  // (the list filter is "my memberships",
  // so C gets an empty list).
  const r5 = await getJson(app, '/api/collab/projects', { 'x-test-user': 'u-c' });
  assert.equal(r5.status, 200);
  assert.equal(r5.body.projects.length, 0);
});

test('P0-1: GET /projects returns exactly the projects the caller is a member of', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
    { id: 'u-c', display_name: 'C' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  // A creates two projects.
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects', {
    id: 'p-2', name: 'P2', kind: 'theoretical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  // A invites B to p-1, C to p-2.
  await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects/p-2/memberships', {
    user_id: 'u-c', role: 'editor', display_name: 'C',
  }, { 'x-test-user': 'u-a' });

  // A sees both projects.
  const a = await getJson(app, '/api/collab/projects', { 'x-test-user': 'u-a' });
  assert.equal(a.body.projects.length, 2);

  // B sees only p-1.
  const b = await getJson(app, '/api/collab/projects', { 'x-test-user': 'u-b' });
  assert.equal(b.body.projects.length, 1);
  assert.equal(b.body.projects[0].id, 'p-1');
  assert.equal(b.body.projects[0].role, 'commenter');

  // C sees only p-2.
  const c = await getJson(app, '/api/collab/projects', { 'x-test-user': 'u-c' });
  assert.equal(c.body.projects.length, 1);
  assert.equal(c.body.projects[0].id, 'p-2');
  assert.equal(c.body.projects[0].role, 'editor');
});

test('P0-2: only the owner can change a member role or remove a member', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });

  const forbidden = await postJson(
    app,
    '/api/collab/projects/p-1/memberships/u-b',
    { role: 'editor' },
    { 'x-test-user': 'u-b' },
    'PATCH',
  );
  assert.equal(forbidden.status, 403);

  const changed = await postJson(
    app,
    '/api/collab/projects/p-1/memberships/u-b',
    { role: 'editor' },
    { 'x-test-user': 'u-a' },
    'PATCH',
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.body.membership.role, 'editor');

  const removed = await postJson(
    app,
    '/api/collab/projects/p-1/memberships/u-b',
    {},
    { 'x-test-user': 'u-a' },
    'DELETE',
  );
  assert.equal(removed.status, 204);
  assert.equal(mockDb._tables.collab_memberships.has('p-1|u-b'), false);
});

// ---------------------------------------------------------------------------
// P0-2 / P0-4: op log push / pull, idempotency, cursor
// ---------------------------------------------------------------------------

test('P0-4: POST /push accepts the op and marks it persisted', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [{ id: 'u-a', display_name: 'A' }]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });

  const res = await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_a',
    ops: [{
      id: 'op_1', client_id: 'cli_a', kind: 'comment-posted',
      payload_json: JSON.stringify({ id: 'cmt_1', authorId: 'u-a' }),
    }],
  }, { 'x-test-user': 'u-a' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.accepted, ['op_1']);
  assert.equal(res.body.rejected.length, 0);
  // The op row is in the log.
  assert.ok(mockDb._tables.collab_op_log.has('cli_a|op_1'));
});

test('P0-4: POST /push is idempotent on (client_id, id) — re-sent op is a no-op', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [{ id: 'u-a', display_name: 'A' }]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  // First push.
  await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_a',
    ops: [{ id: 'op_1', client_id: 'cli_a', kind: 'comment-posted', payload_json: '{"authorId":"u-a"}' }],
  }, { 'x-test-user': 'u-a' });
  // Re-send: still 200, still accepted (the
  // server returns 200 even on dedup; the
  // client treats the dedup as success).
  const r2 = await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_a',
    ops: [{ id: 'op_1', client_id: 'cli_a', kind: 'comment-posted', payload_json: '{"authorId":"u-a"}' }],
  }, { 'x-test-user': 'u-a' });
  assert.deepEqual(r2.body.accepted, ['op_1']);
  // Exactly one row.
  const rows = Array.from(mockDb._tables.collab_op_log.values()).filter(
    (o) => o.project_id === 'p-1',
  );
  assert.equal(rows.length, 1);
});

test('P0-4: POST /push refuses ops with client_id mismatching the request body', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [{ id: 'u-a', display_name: 'A' }]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  const res = await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_a',
    ops: [{ id: 'op_1', client_id: 'cli_other', kind: 'comment-posted', payload_json: '{}' }],
  }, { 'x-test-user': 'u-a' });
  assert.deepEqual(res.body.accepted, []);
  assert.equal(res.body.rejected.length, 1);
  assert.equal(res.body.rejected[0].reason, 'client_id mismatch');
});

test('P0-4: GET /pull returns remote ops since the cursor; filters out self-writes', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });

  // A pushes 2 ops.
  await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_a',
    ops: [
      { id: 'op_a1', client_id: 'cli_a', kind: 'comment-posted', payload_json: '{"authorId":"u-a"}' },
      { id: 'op_a2', client_id: 'cli_a', kind: 'comment-posted', payload_json: '{"authorId":"u-a"}' },
    ],
  }, { 'x-test-user': 'u-a' });
  // B pushes 1 op.
  await postJson(app, '/api/collab/projects/p-1/push', {
    client_id: 'cli_b',
    ops: [{ id: 'op_b1', client_id: 'cli_b', kind: 'comment-posted', payload_json: '{"authorId":"u-b"}' }],
  }, { 'x-test-user': 'u-b' });

  // B pulls — sees A's 2 ops, NOT B's own.
  const r1 = await getJson(app, '/api/collab/projects/p-1/pull?client_id=cli_b', { 'x-test-user': 'u-b' });
  assert.equal(r1.status, 200);
  const ids1 = r1.body.ops.map((o) => o.id);
  assert.deepEqual(ids1, ['op_a1', 'op_a2']);

  // A pulls — sees B's 1 op, NOT A's own.
  const r2 = await getJson(app, '/api/collab/projects/p-1/pull?client_id=cli_a', { 'x-test-user': 'u-a' });
  const ids2 = r2.body.ops.map((o) => o.id);
  assert.deepEqual(ids2, ['op_b1']);

  // Cursor advances. B pulls again with
  // since=<cursor>: 0 ops.
  const r3 = await getJson(app, `/api/collab/projects/p-1/pull?client_id=cli_b&since=${r1.body.cursor}`, { 'x-test-user': 'u-b' });
  assert.equal(r3.body.ops.length, 0);
  assert.equal(r3.body.cursor, r1.body.cursor);
});

// ---------------------------------------------------------------------------
// P0-6: activity
// ---------------------------------------------------------------------------

test('P0-6: activities are visible across members in created_at order', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });

  // A posts 2 activities.
  await postJson(app, '/api/collab/projects/p-1/activities', {
    id: 'a_1', actor_name: 'A', actor_type: 'user', kind: 'comment-posted',
    summary: 'A posted', payload_json: '{}',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects/p-1/activities', {
    id: 'a_2', actor_name: 'A', actor_type: 'user', kind: 'task-shared',
    summary: 'A shared a task', payload_json: '{}',
  }, { 'x-test-user': 'u-a' });

  // B pulls the activity feed.
  const r = await getJson(app, '/api/collab/projects/p-1/activities', { 'x-test-user': 'u-b' });
  assert.equal(r.status, 200);
  const ids = r.body.activities.map((a) => a.id);
  assert.deepEqual(ids, ['a_1', 'a_2']);
  // The summary is in the body.
  assert.equal(r.body.activities[0].summary, 'A posted');
  assert.equal(r.body.activities[1].summary, 'A shared a task');
});

test('P0-6: activity actor_user_id is always req.user.id; body claim is ignored', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-b', display_name: 'B' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  await postJson(app, '/api/collab/projects/p-1/memberships', {
    user_id: 'u-b', role: 'commenter', display_name: 'B',
  }, { 'x-test-user': 'u-a' });
  // B tries to claim an activity as A.
  await postJson(app, '/api/collab/projects/p-1/activities', {
    id: 'a_spoof',
    // Attempt to spoof: server must use
    // req.user.id, not the body.
    actor_user_id: 'u-a',
    actor_name: 'A',
    actor_type: 'user',
    kind: 'comment-posted',
    summary: 'spoofed',
    payload_json: '{}',
  }, { 'x-test-user': 'u-b' });
  const row = mockDb._tables.collab_activities.get('a_spoof');
  assert.equal(row.actor_user_id, 'u-b', 'server must not trust body.actor_user_id');
});

test('P0-2: canonical activities cannot claim to be AI-authored', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [{ id: 'u-a', display_name: 'A' }]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  const res = await postJson(app, '/api/collab/projects/p-1/activities', {
    id: 'a_ai', actor_name: 'Assistant', actor_type: 'ai',
    kind: 'ai-draft-accepted', summary: 'AI wrote canonical state', payload_json: '{}',
  }, { 'x-test-user': 'u-a' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_ACTOR_TYPE');
  assert.equal(mockDb._tables.collab_activities.has('a_ai'), false);
});

test('P0-6: a non-member cannot post an activity', async () => {
  const { mockDb, router } = makeHarness();
  seedUsers(mockDb, [
    { id: 'u-a', display_name: 'A' },
    { id: 'u-c', display_name: 'C' },
  ]);
  seedWorkspace(mockDb, 'u-a');
  const app = makeMockApp();
  app.use('/api/collab', router);
  await postJson(app, '/api/collab/projects', {
    id: 'p-1', name: 'P1', kind: 'empirical', owner_user_id: 'u-a',
  }, { 'x-test-user': 'u-a' });
  const r = await postJson(app, '/api/collab/projects/p-1/activities', {
    id: 'a_1', actor_name: 'C', actor_type: 'user', kind: 'comment-posted',
    summary: 'hi', payload_json: '{}',
  }, { 'x-test-user': 'u-c' });
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function postJson(app, path, body, headers = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const data = JSON.stringify(body);
      const req = require('http').request({
        host: '127.0.0.1', port, path, method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          ...headers,
        },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') }); }
          catch (e) { resolve({ status: res.statusCode, body: chunks }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.write(data);
      req.end();
    });
    server.on('error', reject);
  });
}

function getJson(app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const req = require('http').request({
        host: '127.0.0.1', port, path, method: 'GET',
        headers: { ...headers },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') }); }
          catch (e) { resolve({ status: res.statusCode, body: chunks }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
    server.on('error', reject);
  });
}
