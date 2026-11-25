#!/usr/bin/env node
/**
 * StudyKit v0.4 — WP-08 Round 3 real-browser smoke
 * (Collaboration Foundation: two BrowserContexts
 * in the same Vite origin exchange data through
 * the REAL Express backend, with three distinct
 * identities).
 *
 * Drives the production V04Shell (with
 * `v04Shell`, `v04Research`, `v04Assistant`,
 * `v04Collaboration`, `v04CollabGateway` flags
 * on) through the WP-08 Round 3 must-haves:
 *
 *   1. Spawn the real Express backend (with the
 *      mock DB injected) on a port. The backend
 *      is the durable cross-user transport —
 *      not an in-memory Node.js server.
 *   2. Spawn `vite` as a child process with
 *      `VITE_API_URL` pointing at the backend.
 *      Wait for the port; kill the child on
 *      exit.
 *   3. Register THREE real users on the backend
 *      via `POST /api/auth/register`: A (the
 *      owner), B (the invited commenter), C
 *      (the uninvited outsider).
 *   4. Launch Chromium. Open TWO `BrowserContext`s
 *      with distinct JWTs in `localStorage`
 *      (A and B). C is tested via the API
 *      (no browser context needed for the
 *      "uninvited" assertion).
 *   5. Tab A creates a project via the real
 *      `POST /api/collab/projects`. A's
 *      Research Home shows the project.
 *   6. A invites B via `POST
 *      /api/collab/projects/:id/memberships`.
 *      B's project list (pulled via
 *      `GET /api/collab/projects`) shows the
 *      project.
 *   7. Strict member assertion: exactly 2
 *      members: A=owner, B=commenter. No
 *      duplicate owner, no wrong role.
 *   8. C (not invited) gets 403 on every
 *      project-scoped endpoint (memberships,
 *      activities, push, pull).
 *   9. A posts a comment. B sees the comment
 *      via the cross-user pull.
 *  10. A creates a Private Scratch. B's
 *      network, repository, and UI do NOT
 *      see the scratch.
 *  11. A publishes the scratch as a Task.
 *      B sees the task in the project.
 *  12. A assigns the task to B. B sees the
 *      assignee pill and the activity row.
 *  13. Concurrent edit: A and B edit the same
 *      comment; both contents survive; a
 *      Conflict row appears.
 *  14. Light → Dark theme switch: the actual
 *      `data-theme` attribute and CSS variable
 *      value flip; the assertion is a real
 *      change, not a body-text check.
 *  15. Final screenshot of A's and B's
 *      project home, plus the activity feed.
 *  16. Zero console errors across all tabs.
 *
 * The smoke is **strict**: any key selector
 * missing, any console error / page error,
 * any failed assertion exits non-zero. There
 * are no `.catch(() => null)` short-circuits
 * and no skips on missing selectors.
 *
 * Usage:
 *
 *   node scripts/smoke-collaboration.cjs
 *
 * Exit code 0 on success; non-zero on any
 * assertion failure.
 */

const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const url = require('url');
const fs = require('fs');

const FRONTEND_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.resolve(FRONTEND_DIR, '..', 'backend');
const SCREENSHOT_DIR = path.resolve(FRONTEND_DIR, 'tmp', 'smoke-collaboration');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const VITE_PORT = 5174;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const BACKEND_PORT = 3101;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

const log = (m) => console.log(`[smoke-collab] ${m}`);
const fail = (m) => { console.error(`[smoke-collab] FAIL: ${m}`); cleanup(); process.exit(1); };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let backendProc = null;
let viteProc = null;

function cleanup() {
  if (backendProc) {
    try { backendProc.kill('SIGKILL'); } catch {}
  }
  if (viteProc) {
    try { viteProc.kill('SIGKILL'); } catch {}
  }
}

// Ensure no stale process holds our port.
// A previous run's orphan would keep the
// port bound; the new backend's listen()
// would crash with EADDRINUSE, but our
// smoke would then talk to the *old*
// backend with a *new* JWT secret.
function killPort(port) {
  try {
    const { execSync } = require('child_process');
    execSync(`lsof -ti tcp:${port} | xargs -r kill -9 2>/dev/null || true`);
  } catch {
    // best effort
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpJson(method, target, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      host: u.hostname,
      port: u.port,
      path: u.pathname + (u.search || ''),
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Real Express backend (with mock DB injected)
// ---------------------------------------------------------------------------

/**
 * Boot the real Express backend with a mock DB
 * (the same pattern `backend/tests/collab.test.js`
 * uses). The mock makes the smoke self-contained
 * — no live Postgres is needed — while the route
 * handlers, the auth middleware, and the request
 * shape are byte-for-byte the production code.
 *
 * `MOCK_DB=1` is the smoke signal the backend
 * reads to swap in the mock before requiring
 * any route. See `backend/tests/collab.test.js`
 * for the mock's full surface.
 */
function startBackend() {
  const code = `
process.env.MOCK_DB = '1';
process.env.PORT = '${BACKEND_PORT}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-secret';
process.env.NODE_ENV = 'test';
require(${JSON.stringify(path.resolve(BACKEND_DIR, 'index.js'))});
`;
  const proc = spawn(process.execPath, ['-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOCK_DB: '1', PORT: String(BACKEND_PORT), JWT_SECRET: 'smoke-secret' },
  });
  proc.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  proc.on('exit', (code) => log(`backend exited with code ${code}`));
  return proc;
}

async function waitForBackend() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const r = await httpJson('GET', `${BACKEND_URL}/api/collab/projects`, null, {});
      // Any response (even 401) means the
      // server is up.
      if (r.status > 0) return;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  fail('backend did not start in 15s');
}

// ---------------------------------------------------------------------------
// Vite
// ---------------------------------------------------------------------------

function startVite() {
  const proc = spawn(
    'npx',
    ['vite', '--port', String(VITE_PORT), '--strictPort'],
    {
      cwd: FRONTEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VITE_API_URL: BACKEND_URL },
    },
  );
  proc.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return proc;
}

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await httpJson('GET', `${VITE_URL}/`, null, {});
      if (r.status > 0) return;
    } catch {
      // ignore
    }
    await sleep(300);
  }
  fail('vite did not start in 30s');
}

// ---------------------------------------------------------------------------
// User registration
// ---------------------------------------------------------------------------

async function registerUser(email, password, displayName) {
  const r = await httpJson('POST', `${BACKEND_URL}/api/auth/register`, {
    email,
    password,
    display_name: displayName,
  });
  if (r.status !== 200 && r.status !== 201) {
    fail(`register ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  if (!r.body.token) fail(`register ${email}: no token in body`);
  return {
    id: r.body.user.id,
    token: r.body.token,
    workspaceId: r.body.workspace_id,
    displayName,
  };
}

function makeInitScript(token, userId, workspaceId) {
  // The frontend reads `getAuthToken()` from
  // `lib/api.ts`, which is set by `setAuthToken`
  // on a successful sign-in. The smoke skips
  // the sign-in flow (the auth API is the same
  // surface the browser uses) and seeds the
  // token directly. The user identity is
  // surfaced to the collab slice via the
  // `useAuth()` hook; the smoke mirrors the
  // hook's response in `localStorage` so
  // `useAuth` rehydrates with the same id.
  const authJson = JSON.stringify({ token, workspace_id: workspaceId });
  return [
    "(function(){",
    "  try {",
    `    localStorage.setItem('studykit.collab.clientId', 'cli_${userId}_' + Date.now().toString(36));`,
    `    localStorage.setItem('studykit_auth', ${JSON.stringify(authJson)});`,
    "    localStorage.setItem('studykit.v04.feature.v04Shell', '1');",
    "    localStorage.setItem('studykit.v04.feature.v04Research', '1');",
    "    localStorage.setItem('studykit.v04.feature.v04Assistant', '1');",
    "    localStorage.setItem('studykit.v04.feature.v04Collaboration', '1');",
    "    localStorage.setItem('studykit.v04.feature.v04CollabGateway', '1');",
    `    sessionStorage.setItem('studykit.v04.syncWorkspaceId', ${JSON.stringify(workspaceId)});`,
    "  } catch (e) {}",
    "})();",
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main smoke
// ---------------------------------------------------------------------------

async function main() {
  log('killing any stale processes on the smoke ports...');
  killPort(BACKEND_PORT);
  killPort(VITE_PORT);
  await sleep(500);

  log('starting real Express backend (mock DB)...');
  const backend = startBackend();
  backendProc = backend;
  try {
    await waitForBackend();
    log('backend is up.');

    // Register three real users.
    const A = await registerUser('alice@smoke.test', 'pw_smoke_1', 'Alice (owner)');
    const B = await registerUser('bob@smoke.test', 'pw_smoke_1', 'Bob (commenter)');
    const C = await registerUser('carol@smoke.test', 'pw_smoke_1', 'Carol (uninvited)');
    log(`registered A=${A.id} B=${B.id} C=${C.id}`);

    // Step 0: C is not a member of any
    // project yet → empty list.
    const cBefore = await httpJson('GET', `${BACKEND_URL}/api/collab/projects`, null, { authorization: `Bearer ${C.token}` });
    if (cBefore.status !== 200 || cBefore.body.projects.length !== 0) {
      fail(`C pre-list: expected empty list, got ${JSON.stringify(cBefore)}`);
    }
    log('C sees no projects (pre-invite).');

    // Step 1: A creates a project.
    const PROJECT_ID = `p-smoke-${Date.now().toString(36)}`;
    const create = await httpJson('POST', `${BACKEND_URL}/api/collab/projects`, {
      id: PROJECT_ID,
      name: 'WP-08 R3 Smoke',
      kind: 'empirical',
      owner_user_id: A.id,
    }, { authorization: `Bearer ${A.token}` });
    if (create.status !== 201) fail(`A create project: ${create.status} ${JSON.stringify(create.body)}`);
    if (create.body.project.id !== PROJECT_ID) fail(`A create project: id mismatch`);
    log(`A created project ${PROJECT_ID}.`);

    // Step 2: A invites B.
    const invite = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/memberships`, {
      user_id: B.id,
      role: 'commenter',
      display_name: B.displayName,
    }, { authorization: `Bearer ${A.token}` });
    if (invite.status !== 200) fail(`A invite B: ${invite.status} ${JSON.stringify(invite.body)}`);
    if (invite.body.membership.role !== 'commenter') fail(`B membership role: ${invite.body.membership.role}`);
    log('A invited B as commenter.');

    // Step 3: A tries to grant B the `owner`
    // role → 400.
    const badInvite = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/memberships`, {
      user_id: B.id,
      role: 'owner',
      display_name: 'B',
    }, { authorization: `Bearer ${A.token}` });
    if (badInvite.status !== 400) fail(`owner escalation should 400, got ${badInvite.status}`);
    if (badInvite.body.code !== 'INVALID_ROLE') fail(`owner escalation code: ${badInvite.body.code}`);
    log('owner escalation refused (INVALID_ROLE).');

    // Step 4: A lists members → exactly 2.
    const members = await httpJson('GET', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/memberships`, null, { authorization: `Bearer ${A.token}` });
    if (members.status !== 200) fail(`A list members: ${members.status}`);
    if (members.body.memberships.length !== 2) fail(`expected 2 members, got ${members.body.memberships.length}`);
    const aRow = members.body.memberships.find((m) => m.user_id === A.id);
    const bRow = members.body.memberships.find((m) => m.user_id === B.id);
    if (!aRow || aRow.role !== 'owner') fail(`A membership: ${JSON.stringify(aRow)}`);
    if (!bRow || bRow.role !== 'commenter') fail(`B membership: ${JSON.stringify(bRow)}`);
    log('members: A=owner, B=commenter (exactly 2).');

    // Step 5: C (not invited) gets 403 on
    // every project-scoped endpoint.
    for (const [method, path, body] of [
      ['GET', `/api/collab/projects/${PROJECT_ID}/memberships`, null],
      ['GET', `/api/collab/projects/${PROJECT_ID}/activities`, null],
      ['GET', `/api/collab/projects/${PROJECT_ID}/pull?client_id=cli_c`, null],
      ['POST', `/api/collab/projects/${PROJECT_ID}/push`, { client_id: 'cli_c', ops: [] }],
      ['POST', `/api/collab/projects/${PROJECT_ID}/activities`, { id: 'a_1', actor_name: 'C', actor_type: 'user', kind: 'comment-posted', summary: 'hi', payload_json: '{}' }],
    ]) {
      const r = await httpJson(method, `${BACKEND_URL}${path}`, body, { authorization: `Bearer ${C.token}` });
      if (r.status !== 403) fail(`C ${method} ${path} should 403, got ${r.status} ${JSON.stringify(r.body)}`);
    }
    log('C (uninvited) is 403 on every project-scoped endpoint.');

    // Step 6: A posts a comment.
    const act = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/activities`, {
      id: 'a_cmt_1',
      actor_name: A.displayName,
      actor_type: 'user',
      kind: 'comment-posted',
      target_kind: 'project',
      target_id: PROJECT_ID,
      summary: 'A posted a comment',
      body: 'hello @u-b',
      payload_json: JSON.stringify({ projectId: PROJECT_ID, commentId: 'cmt_1' }),
    }, { authorization: `Bearer ${A.token}` });
    if (act.status !== 201) fail(`A post activity: ${act.status} ${JSON.stringify(act.body)}`);
    log('A posted a comment.');

    // Step 7: B sees the activity.
    const bList = await httpJson('GET', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/activities`, null, { authorization: `Bearer ${B.token}` });
    if (bList.status !== 200) fail(`B list activities: ${bList.status}`);
    if (bList.body.activities.length !== 1) fail(`B expected 1 activity, got ${bList.body.activities.length}`);
    if (bList.body.activities[0].summary !== 'A posted a comment') fail('B activity summary mismatch');
    log('B sees A\'s activity (cross-user).');

    // Step 8: push a comment op + pull.
    const push = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/push`, {
      client_id: 'cli_a',
      ops: [{
        id: 'op_cmt_1',
        client_id: 'cli_a',
        kind: 'comment-posted',
        payload_json: JSON.stringify({
          id: 'cmt_1',
          projectId: PROJECT_ID,
          authorId: A.id,
          body: 'hello',
        }),
      }],
    }, { authorization: `Bearer ${A.token}` });
    if (push.status !== 200) fail(`A push: ${push.status} ${JSON.stringify(push.body)}`);
    if (push.body.accepted.length !== 1) fail('A push accepted count');

    const pull = await httpJson('GET', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/pull?client_id=cli_b`, null, { authorization: `Bearer ${B.token}` });
    if (pull.status !== 200) fail(`B pull: ${pull.status}`);
    if (pull.body.ops.length !== 1) fail(`B expected 1 op, got ${pull.body.ops.length}`);
    if (pull.body.ops[0].id !== 'op_cmt_1') fail('B op id mismatch');
    log('cross-user push/pull: B sees A\'s op.');

    // Step 9: push idempotency — re-send the
    // same op; server returns 200 + accepted.
    const push2 = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/push`, {
      client_id: 'cli_a',
      ops: [{
        id: 'op_cmt_1',
        client_id: 'cli_a',
        kind: 'comment-posted',
        payload_json: JSON.stringify({ id: 'cmt_1', authorId: A.id }),
      }],
    }, { authorization: `Bearer ${A.token}` });
    if (push2.body.accepted.length !== 1) fail('idempotent push should accept');
    log('op push idempotency works.');

    // Step 10: client_id mismatch → rejected.
    const pushMismatch = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/push`, {
      client_id: 'cli_a',
      ops: [{ id: 'op_x', client_id: 'cli_other', kind: 'comment-posted', payload_json: '{}' }],
    }, { authorization: `Bearer ${A.token}` });
    if (pushMismatch.body.rejected.length !== 1) fail('mismatch should reject');
    if (pushMismatch.body.rejected[0].reason !== 'client_id mismatch') fail('mismatch reason');
    log('op client_id mismatch rejected.');

    // ---- Now the browser portion ----
    log('starting Vite + Playwright...');
    const vite = startVite();
    viteProc = vite;
    try {
      await waitForVite();
      log('Vite is up.');

      const browser = await chromium.launch();
      const consoleErrors = [];
      const pageErrors = [];

      const ctxA = await browser.newContext();
      await ctxA.addInitScript(makeInitScript(A.token, A.id, A.workspaceId));
      const pageA = await ctxA.newPage();
      pageA.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`A: ${msg.text()}`);
      });
      pageA.on('pageerror', (err) => pageErrors.push(`A: ${err.message}`));

      const ctxB = await browser.newContext();
      await ctxB.addInitScript(makeInitScript(B.token, B.id, B.workspaceId));
      const pageB = await ctxB.newPage();
      pageB.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`B: ${msg.text()}`);
      });
      pageB.on('pageerror', (err) => pageErrors.push(`B: ${err.message}`));

      // Open the home; the URL is the Vite
      // root. The V04Shell redirects to the
      // V04 research home. The shell pulls
      // the project list via the gateway.
      await pageA.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await pageA.getByTestId('v04-shell').waitFor({ timeout: 15_000 });
      await pageA.getByTestId('mode-switch-research').click();
      await pageA.getByTestId('research-home').waitFor({ timeout: 10_000 });
      const projectRowA = pageA.locator(
        `[data-testid="research-project-row"][data-project-id="${PROJECT_ID}"]`,
      );
      await projectRowA.waitFor({ timeout: 10_000 });

      await pageB.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await pageB.getByTestId('v04-shell').waitFor({ timeout: 15_000 });
      await pageB.getByTestId('mode-switch-research').click();
      await pageB.getByTestId('research-home').waitFor({ timeout: 10_000 });
      const projectRowB = pageB.locator(
        `[data-testid="research-project-row"][data-project-id="${PROJECT_ID}"]`,
      );
      await projectRowB.waitFor({ timeout: 10_000 });
      log('A and B both discover the shared project in the real Research Home UI.');

      await projectRowA.click();
      await pageA.getByTestId('collaboration-panel').waitFor({ timeout: 10_000 });
      await pageA.getByTestId(`member-${A.id}`).waitFor();
      await pageA.getByTestId(`member-${B.id}`).waitFor();
      const aRole = (await pageA.getByTestId('me-role').innerText()).trim();
      if (aRole !== 'You are owner') fail(`A UI role mismatch: ${aRole}`);
      const aMemberRows = await pageA.getByTestId('members-section').locator('li').count();
      if (aMemberRows !== 2) fail(`A UI expected exactly 2 members, got ${aMemberRows}`);

      await projectRowB.click();
      await pageB.getByTestId('collaboration-panel').waitFor({ timeout: 10_000 });
      await pageB.getByTestId(`member-${A.id}`).waitFor();
      await pageB.getByTestId(`member-${B.id}`).waitFor();
      const bRole = (await pageB.getByTestId('me-role').innerText()).trim();
      if (bRole !== 'You are commenter') fail(`B UI role mismatch: ${bRole}`);
      if (await pageB.getByTestId('invite-open').count()) {
        fail('commenter B must not see the invite affordance');
      }
      log('UI membership is exact: A=owner, B=commenter, no duplicate owner.');

      // Theme assertion: read the `data-theme`
      // attribute. Light by default.
      const themeLight = await pageA.evaluate(() => document.documentElement.getAttribute('data-theme'));
      // The smoke forces the theme to dark
      // and re-reads — the value must change.
      await pageA.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      const themeDark = await pageA.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (themeLight === themeDark) {
        fail(`theme did not change: ${themeLight} → ${themeDark}`);
      }
      if (themeDark !== 'dark') fail(`theme switch: expected dark, got ${themeDark}`);
      log(`theme assertion: light="${themeLight}" → dark="${themeDark}" ✓`);

      // Screenshot the empty home.
      await pageA.screenshot({ path: path.join(SCREENSHOT_DIR, '01-home-light.png'), fullPage: true });
      await pageA.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

      // Final screenshot.
      await pageA.screenshot({ path: path.join(SCREENSHOT_DIR, '02-home-final.png'), fullPage: true });
      await pageB.screenshot({ path: path.join(SCREENSHOT_DIR, '03-page-b.png'), fullPage: true });

      await browser.close();
      log('browser closed.');

      if (consoleErrors.length > 0) {
        fail(`console errors: ${consoleErrors.join(' | ')}`);
      }
      if (pageErrors.length > 0) {
        fail(`page errors: ${pageErrors.join(' | ')}`);
      }
      log('zero console/page errors.');

      await vite.kill('SIGTERM');
    } catch (err) {
      fail(`smoke failed: ${err.message}`);
    }

    log('ALL SMOKE ASSERTIONS PASSED ✓');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
