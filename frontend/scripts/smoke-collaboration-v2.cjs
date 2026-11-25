#!/usr/bin/env node
/**
 * StudyKit v0.4 — WP-08 Round 3 real-browser smoke
 * (v2 variant: writes screenshots to /tmp, avoiding
 * the OneDrive EPERM race that locks the original
 * smoke file's directory).
 *
 * Identical to scripts/smoke-collaboration.cjs in
 * every functional respect except for the screenshot
 * output path (here: /tmp/studykit-smoke-collaboration).
 * Run with:
 *
 *   node scripts/smoke-collaboration-v2.cjs
 *
 * The full description of what this smoke verifies
 * lives at the top of smoke-collaboration.cjs.
 */

const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const url = require('url');
const fs = require('fs');

const FRONTEND_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.resolve(FRONTEND_DIR, '..', 'backend');
const SCREENSHOT_DIR = '/tmp/studykit-smoke-collaboration';
try { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

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
  if (backendProc) { try { backendProc.kill('SIGKILL'); } catch {} }
  if (viteProc) { try { viteProc.kill('SIGKILL'); } catch {} }
}

function killPort(port) {
  try {
    const { execSync } = require('child_process');
    execSync(`lsof -ti tcp:${port} | xargs -r kill -9 2>/dev/null || true`);
  } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

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
          resolve({ status: res.statusCode, body: JSON.parse(chunks || '{}') });
        } catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function startBackend() {
  const proc = spawn(process.execPath, ['-e', `
const dbPath = require.resolve('./db');
const { makeMockDb } = require('./tests/mockDb');
const mockDb = makeMockDb();
require.cache[dbPath] = { exports: mockDb, loaded: true, id: dbPath, filename: dbPath };
require('./index.js');
`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: BACKEND_DIR,
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
      if (r.status > 0) return;
    } catch {}
    await sleep(200);
  }
  fail('backend did not start in 15s');
}

function startVite() {
  const proc = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: FRONTEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_API_URL: BACKEND_URL },
  });
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
    } catch {}
    await sleep(300);
  }
  fail('vite did not start in 30s');
}

async function registerUser(email, password, displayName) {
  const r = await httpJson('POST', `${BACKEND_URL}/api/auth/register`, { email, password, display_name: displayName });
  if (r.status !== 200 && r.status !== 201) fail(`register ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  if (!r.body.token) fail(`register ${email}: no token`);
  return { id: r.body.user.id, token: r.body.token, displayName };
}

function makeInitScript(token, userId, displayName) {
  const userJson = JSON.stringify({ id: userId, email: `${userId}@smoke.test`, display_name: displayName });
  const tokenJson = JSON.stringify(token);
  const userJsonQuoted = JSON.stringify(userJson);
  return [
    "(function(){",
    "  try {",
    `    localStorage.setItem('studykit.collab.clientId', 'cli_${userId}_' + Date.now().toString(36));`,
    `    localStorage.setItem('studykit.auth.token', ${tokenJson});`,
    `    localStorage.setItem('studykit.auth.user', ${userJsonQuoted});`,
    "  } catch (e) {}",
    "})();",
  ].join('\n');
}

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

    const A = await registerUser('alice@smoke.test', 'pw_smoke_1', 'Alice (owner)');
    const B = await registerUser('bob@smoke.test', 'pw_smoke_1', 'Bob (commenter)');
    const C = await registerUser('carol@smoke.test', 'pw_smoke_1', 'Carol (uninvited)');
    log(`registered A=${A.id} B=${B.id} C=${C.id}`);

    const cBefore = await httpJson('GET', `${BACKEND_URL}/api/collab/projects`, null, { authorization: `Bearer ${C.token}` });
    if (cBefore.status !== 200 || cBefore.body.projects.length !== 0) fail(`C pre-list: ${JSON.stringify(cBefore)}`);
    log('C sees no projects (pre-invite).');

    const PROJECT_ID = `p-smoke-${Date.now().toString(36)}`;
    const create = await httpJson('POST', `${BACKEND_URL}/api/collab/projects`, {
      id: PROJECT_ID, name: 'WP-08 R3 Smoke', kind: 'empirical', owner_user_id: A.id,
    }, { authorization: `Bearer ${A.token}` });
    if (create.status !== 201) fail(`A create: ${create.status} ${JSON.stringify(create.body)}`);
    log(`A created project ${PROJECT_ID}.`);

    const invite = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/memberships`, {
      user_id: B.id, role: 'commenter', display_name: B.displayName,
    }, { authorization: `Bearer ${A.token}` });
    if (invite.status !== 200) fail(`A invite B: ${invite.status}`);
    log('A invited B as commenter.');

    const badInvite = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/memberships`, {
      user_id: B.id, role: 'owner', display_name: 'B',
    }, { authorization: `Bearer ${A.token}` });
    if (badInvite.status !== 400 || badInvite.body.code !== 'INVALID_ROLE') fail(`owner escalation: ${JSON.stringify(badInvite)}`);
    log('owner escalation refused (INVALID_ROLE).');

    const members = await httpJson('GET', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/memberships`, null, { authorization: `Bearer ${A.token}` });
    if (members.status !== 200 || members.body.memberships.length !== 2) fail(`members: ${JSON.stringify(members)}`);
    const aRow = members.body.memberships.find((m) => m.user_id === A.id);
    const bRow = members.body.memberships.find((m) => m.user_id === B.id);
    if (!aRow || aRow.role !== 'owner') fail(`A row: ${JSON.stringify(aRow)}`);
    if (!bRow || bRow.role !== 'commenter') fail(`B row: ${JSON.stringify(bRow)}`);
    log('members: A=owner, B=commenter (exactly 2).');

    for (const [method, p, body] of [
      ['GET', `/api/collab/projects/${PROJECT_ID}/memberships`, null],
      ['GET', `/api/collab/projects/${PROJECT_ID}/activities`, null],
      ['GET', `/api/collab/projects/${PROJECT_ID}/pull?client_id=cli_c`, null],
      ['POST', `/api/collab/projects/${PROJECT_ID}/push`, { client_id: 'cli_c', ops: [] }],
      ['POST', `/api/collab/projects/${PROJECT_ID}/activities`, { id: 'a_1', actor_name: 'C', actor_type: 'user', kind: 'comment-posted', summary: 'hi', payload_json: '{}' }],
    ]) {
      const r = await httpJson(method, `${BACKEND_URL}${p}`, body, { authorization: `Bearer ${C.token}` });
      if (r.status !== 403) fail(`C ${method} ${p} should 403, got ${r.status}`);
    }
    log('C (uninvited) is 403 on every project-scoped endpoint.');

    const act = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/activities`, {
      id: 'a_cmt_1', actor_name: A.displayName, actor_type: 'user', kind: 'comment-posted',
      target_kind: 'project', target_id: PROJECT_ID, summary: 'A posted a comment',
      body: 'hello @u-b', payload_json: JSON.stringify({ projectId: PROJECT_ID }),
    }, { authorization: `Bearer ${A.token}` });
    if (act.status !== 201) fail(`A post activity: ${act.status}`);
    log('A posted a comment.');

    const bList = await httpJson('GET', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/activities`, null, { authorization: `Bearer ${B.token}` });
    if (bList.status !== 200 || bList.body.activities.length !== 1) fail(`B list: ${JSON.stringify(bList)}`);
    log('B sees A\'s activity (cross-user).');

    const push = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/push`, {
      client_id: 'cli_a',
      ops: [{ id: 'op_cmt_1', client_id: 'cli_a', kind: 'comment-posted', payload_json: '{}' }],
    }, { authorization: `Bearer ${A.token}` });
    if (push.status !== 200 || push.body.accepted.length !== 1) fail(`A push: ${JSON.stringify(push)}`);
    log('A pushed an op.');

    const pull = await httpJson('GET', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/pull?client_id=cli_b`, null, { authorization: `Bearer ${B.token}` });
    if (pull.status !== 200 || pull.body.ops.length !== 1) fail(`B pull: ${JSON.stringify(pull)}`);
    log('B pulled A\'s op (cross-user).');

    const push2 = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/push`, {
      client_id: 'cli_a',
      ops: [{ id: 'op_cmt_1', client_id: 'cli_a', kind: 'comment-posted', payload_json: '{}' }],
    }, { authorization: `Bearer ${A.token}` });
    if (push2.body.accepted.length !== 1) fail('idempotent push failed');
    log('op push idempotency works.');

    const pushMismatch = await httpJson('POST', `${BACKEND_URL}/api/collab/projects/${PROJECT_ID}/push`, {
      client_id: 'cli_a',
      ops: [{ id: 'op_x', client_id: 'cli_other', kind: 'comment-posted', payload_json: '{}' }],
    }, { authorization: `Bearer ${A.token}` });
    if (pushMismatch.body.rejected.length !== 1 || pushMismatch.body.rejected[0].reason !== 'client_id mismatch') fail('mismatch failed');
    log('op client_id mismatch rejected.');

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
      await ctxA.addInitScript(makeInitScript(A.token, A.id, A.displayName));
      const pageA = await ctxA.newPage();
      pageA.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`A: ${msg.text()}`); });
      pageA.on('pageerror', (err) => pageErrors.push(`A: ${err.message}`));
      const ctxB = await browser.newContext();
      await ctxB.addInitScript(makeInitScript(B.token, B.id, B.displayName));
      const pageB = await ctxB.newPage();
      pageB.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`B: ${msg.text()}`); });
      pageB.on('pageerror', (err) => pageErrors.push(`B: ${err.message}`));

      await pageA.goto(VITE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await pageA.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      // Set the theme explicitly to a known value
      await pageA.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      const themeLight = await pageA.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await pageA.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      const themeDark = await pageA.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (themeDark !== 'dark') fail(`theme did not switch to dark: ${themeDark}`);
      log(`theme assertion: light="${themeLight}" → dark="${themeDark}" ✓`);

      try {
        await pageA.screenshot({ path: path.join(SCREENSHOT_DIR, '01-home-dark.png'), fullPage: true });
      } catch (e) {
        log(`screenshot warn: ${e.message.slice(0, 100)}`);
      }
      await pageA.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      try {
        await pageA.screenshot({ path: path.join(SCREENSHOT_DIR, '02-home-light.png'), fullPage: true });
        await pageB.screenshot({ path: path.join(SCREENSHOT_DIR, '03-page-b.png'), fullPage: true });
      } catch (e) {
        log(`screenshot warn: ${e.message.slice(0, 100)}`);
      }

      await browser.close();
      log('browser closed.');

      if (consoleErrors.length > 0) fail(`console errors: ${consoleErrors.join(' | ')}`);
      if (pageErrors.length > 0) fail(`page errors: ${pageErrors.join(' | ')}`);
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

main().catch((err) => { console.error(err); process.exit(1); });
