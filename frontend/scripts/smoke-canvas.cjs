#!/usr/bin/env node
/**
 * StudyKit v0.4 — WP-06 final real-browser smoke test
 * (Cognitive Canvas composition, 50-node performance)
 *
 * Drives the production Vite app in headless Chromium
 * and exercises the Cognitive Canvas end-to-end:
 *
 *   1. Spin up `vite` as a child process (the dev
 *      server is the production surface); wait for
 *      the port. Kill the child on exit so the
 *      script is self-cleaning.
 *   2. Launch Chromium. Inject the v04Shell /
 *      v04Research / v04Canvas / v04Assistant
 *      feature flags + the dev-seam fixture AI
 *      provider router via `addInitScript`.
 *   3. Seed 50 verified evidence + 1 claim in the
 *      research Dexie, then call
 *      `useCases.openInCanvas(...)` with 50
 *      `objectRefs` against the production
 *      `createDexieCanvasRepository`. The seed
 *      uses the Vite-served module graph (no
 *      production-architecture change).
 *   4. Reload the page; the Cognitive Canvas view
 *      subscribes to the same Dexie and renders 50
 *      `.react-flow__node` elements.
 *   5. Assert: ≥50 visible nodes, no `pageerror` /
 *      no `console error`. Light + Dark both render
 *      without errors. Viewport control (parent
 *      Ctrl+'=' keydown → shared xyflow store)
 *      observably mutates the surface's
 *      `.react-flow__viewport` transform style.
 *   6. Outline path: Tab focus + 'o' toggle reaches
 *      the outline view. Reload preserves the
 *      same view / placements.
 *   7. Measure real rAF throughput for ≥2 s while
 *      dispatching continuous pan/zoom wheel
 *      events. The gate is ≥55 fps. Do not fake
 *      rAF; do not substitute synchronous render
 *      time.
 *
 * The only "dev seam" is the existing
 * `globalThis.__studykitDevSmoke` (already used
 * by `smoke-research.cjs`); no new architecture
 * was added.
 *
 * Usage:
 *
 *   node scripts/smoke-canvas.cjs
 *
 * Exit code 0 on success; non-zero on any assertion
 * failure. The script starts the dev server itself
 * and kills it on exit.
 */

const { spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FRONTEND_DIR = path.resolve(__dirname, '..');
const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEW_ID = 'canvas-smoke-1';
const PROJECT_ID = 'smoke-project-1';
const SEED_COUNT = 50;
const FPS_GATE = 55;
const FPS_WINDOW_MS = 2000;

const log = (m) => console.log(`[smoke-canvas] ${m}`);
const fail = (m) => { console.error(`[smoke-canvas] FAIL: ${m}`); process.exit(1); };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startViteServer() {
  const child = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: FRONTEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:3001' },
  });
  const cleanup = () => { try { child.kill('SIGTERM'); } catch (_) {} };
  process.on('exit', cleanup);
  // Wait for the port.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 304) return child;
    } catch (_) { /* try again */ }
    await sleep(500);
  }
  cleanup();
  fail('Vite dev server did not start within 30s');
}

async function findServerPort() {
  // Allow the script to attach to an already-running
  // dev server when one is available (faster reruns).
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 304) return null; // reuse
    } catch (_) { /* try again */ }
    await sleep(500);
  }
  return startViteServer();
}

async function main() {
  log('=== WP-06 final Gate — Cognitive Canvas browser smoke ===');
  const viteChild = await findServerPort();
  if (viteChild) {
    log(`Vite dev server spawned on ${BASE_URL} (pid ${viteChild.pid})`);
  } else {
    log(`Vite dev server already running on ${BASE_URL} (reusing)`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter pdfjs / KaTeX noise (mirrors existing smokes).
      if (!/pdfjs|katex|cloudflare|cors/i.test(text)) {
        consoleErrors.push(text);
        log(`[browser:error] ${text}`);
      }
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    log(`[pageerror] ${err.message}`);
  });

  // ----- Dev-seam + feature flags -----
  // The `CanvasUseCasesProvider` reads BOTH
  // `useResearchDeps()` AND `useStudyDeps()` so the
  // V04 shell's `<StudyWiring>` must also be on
  // (Round 6 P0-2: the cognitive canvas's runtime
  // is the *single* `CanvasRuntime` the router
  // reads, and it must be non-null). When
  // `v04Study` is off, the `useStudyDepsOptional()`
  // hook returns `null` and the cognitive-canvas
  // branch falls into the "Cognitive canvas is
  // unavailable" state.
  await context.addInitScript(() => {
    localStorage.setItem('studykit.v04.feature.v04Shell', '1');
    localStorage.setItem('studykit.v04.feature.v04Research', '1');
    localStorage.setItem('studykit.v04.feature.v04Study', '1');
    localStorage.setItem('studykit.v04.feature.v04Canvas', '1');
    localStorage.setItem('studykit.v04.feature.v04Assistant', '1');
    localStorage.setItem('studykit.v04.localWorkspace', '1');
    window.__studykitDevSmoke = {
      openAlex: {
        search: async () => ({ results: [] }),
      },
      providerRouter: {
        probe: async () => ({
          kind: 'available',
          provider: 'ollama',
          aiAvailable: true,
          providerName: 'ollama',
        }),
        chat: async () => ({ content: 'stubbed AI response', provider: 'ollama' }),
      },
    };
  });

  // ----- 1. Load the app -----
  log('1. Loading the v04 shell...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="v04-header"]', { timeout: 10_000 });
  log('   v04 shell mounted.');

  // ----- 2. Seed 50 evidence + open canvas -----
  log(`2. Seeding ${SEED_COUNT} evidence rows + canvas view via the production use cases...`);
  const seedSummary = await page.evaluate(
    async ({ viewId, projectId, count }) => {
      const { createDexieResearchRepository } = await import('/src/platforms/web/dexieResearchRepository.ts');
      const { createDexieCanvasRepository } = await import('/src/platforms/web/dexieCanvasRepository.ts');
      const { createCanvasUseCases } = await import('/src/application/canvas/canvasGateway.ts');
      const research = createDexieResearchRepository();
      const canvas = createDexieCanvasRepository();
      const objects = research; // simplified; the Dexie canvas reads via ShimStudyKitRepository
      const n = (() => { let i = 0; return () => ++i; })();
      const useCases = createCanvasUseCases({
        repository: canvas,
        objects,
        now: () => new Date(2026, 6, 22, 12, 0, n()).toISOString(),
        newId: () => `id_${n()}_${Math.random().toString(36).slice(2, 8)}`,
      });
      // Seed the project + 50 evidence rows.
      await research.transact(async (tx) => {
        tx.putProject({
          id: projectId,
          container: { workspaceId: 'ws-smoke', mode: 'research', kind: 'project', id: projectId },
          name: 'Smoke project',
          kind: 'blank',
          livingBrief: '',
          createdAt: '2026-07-22T00:00:00.000Z',
          updatedAt: '2026-07-22T00:00:00.000Z',
          authorType: 'user',
        });
        for (let i = 1; i <= count; i++) {
          tx.putWork({
            id: `w-${i}`,
            projectIds: [projectId],
            identifiers: {},
            title: `Work ${i}`,
            authors: [],
            readingStatus: 'unread',
            assetIds: [],
            metadataProvenance: {},
            integrity: 'unknown',
            importance: 0,
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:00.000Z',
            authorType: 'user',
          });
          tx.putEvidence({
            id: `ev-${i}`,
            projectId,
            workId: `w-${i}`,
            locator: { kind: 'paper-work', workId: `w-${i}`, capturedAt: '2026-07-22T00:00:00.000Z' },
            exactQuote: `Passage ${i}.`,
            userInterpretation: `Reading ${i}.`,
            evidenceType: 'finding',
            status: 'verified',
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:00.000Z',
            authorType: 'user',
          });
        }
      });
      // Open the canvas view + 50 placements via the
      // production `useCases.openInCanvas`.
      const container = { workspaceId: 'ws-smoke', mode: 'research', kind: 'project', id: projectId };
      const refs = Array.from({ length: count }, (_, i) => ({
        kind: 'knowledge',
        id: `ev-${i + 1}`,
        objectKind: 'evidence',
      }));
      const r = await useCases.openInCanvas({ viewId, container, objectRefs: refs });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, count };
    },
    { viewId: VIEW_ID, projectId: PROJECT_ID, count: SEED_COUNT },
  );
  if (!seedSummary.ok) fail(`seed failed: ${JSON.stringify(seedSummary)}`);
  log(`   ${seedSummary.count} evidence + ${SEED_COUNT} placements seeded.`);

  // ----- 3. Navigate to the cognitive canvas URL -----
  log('3. Navigating to the cognitive canvas...');
  await page.goto(
    `${BASE_URL}/#/research/cognitive-canvas/${PROJECT_ID}?__sid=${VIEW_ID}`,
    { waitUntil: 'networkidle' },
  );
  // Debug: log the URL hash + the actual DOM state.
  const debug = await page.evaluate(async () => {
    const v04Canvas = localStorage.getItem('studykit.v04.feature.v04Canvas');
    const v04Research = localStorage.getItem('studykit.v04.feature.v04Research');
    const v04Shell = localStorage.getItem('studykit.v04.feature.v04Shell');
    // Probe the cognitive canvas Dexie view.
    let dexieView = null;
    let dexiePlacements = null;
    try {
      const { createDexieCanvasRepository } = await import('/src/platforms/web/dexieCanvasRepository.ts');
      const repo = createDexieCanvasRepository();
      const view = await repo.getView('canvas-smoke-1');
      const snap = await repo.getViewSnapshot('canvas-smoke-1');
      dexieView = view ? { id: view.id, container: view.container } : null;
      dexiePlacements = snap.placements.length;
    } catch (e) {
      dexieView = `err: ${e.message}`;
    }
    return {
      hash: window.location.hash,
      v04Canvas, v04Research, v04Shell,
      surface: !!document.querySelector('.react-flow'),
      flowHost: !!document.querySelector('[data-testid="cognitive-canvas-flow"]'),
      flowLoading: !!document.querySelector('[data-testid="cognitive-canvas-loading"]'),
      flowUnavailable: !!document.querySelector('[data-testid="cognitive-canvas-unavailable"]'),
      unavailableText: document.querySelector('[data-testid="cognitive-canvas-unavailable"]')?.textContent ?? null,
      header: !!document.querySelector('[data-testid="v04-header"]'),
      nodeCount: document.querySelectorAll('.react-flow__node').length,
      devSmoke: !!window.__studykitDevSmoke,
      dexieView, dexiePlacements,
    };
  });
  log(`   debug: ${JSON.stringify(debug)}`);
  // Wait for the surface to render ≥50 nodes.
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length >= n,
    SEED_COUNT,
    { timeout: 15_000 },
  );
  const renderedNodeCount = await page.locator('.react-flow__node').count();
  log(`   surface mounted with ${renderedNodeCount} .react-flow__node elements.`);
  if (renderedNodeCount < SEED_COUNT) {
    fail(`Expected ≥${SEED_COUNT} visible nodes, got ${renderedNodeCount}`);
  }

  // ----- 4. Viewport control: the cognitive canvas's
  //  production "Fit to content" toolbar button →
  //  shared xyflow store → surface transform
  //  mutation. The literature canvas has a
  //  parent-level Ctrl+'+' keydown (Round 8 test
  //  pattern), but the cognitive canvas's zoom
  //  affordance is the toolbar's Fit button. The
  //  button drives the *same* `useReactFlow` store
  //  (the `CanvasSurfaceProvider` is the single
  //  source of truth for both the controller and
  //  the surface, per Round 6 P0-1).
  log('4. Viewport control: clicking the cognitive canvas Fit toolbar button...');
  const viewportBefore = await page.$eval('.react-flow__viewport', (el) => el.getAttribute('style'));
  await page.locator('[data-testid="cognitive-canvas-fit-view"]').click({ timeout: 5000 });
  await page.waitForFunction(
    (b) => {
      const el = document.querySelector('.react-flow__viewport');
      return el && el.getAttribute('style') !== b;
    },
    viewportBefore,
    { timeout: 5000 },
  );
  const viewportAfter = await page.$eval('.react-flow__viewport', (el) => el.getAttribute('style'));
  if (viewportAfter === viewportBefore) {
    fail('viewport transform did not change after Fit (parent hook may be on a different store)');
  }
  log(`   viewport transform changed: ${viewportBefore} → ${viewportAfter.slice(0, 80)}…`);

  // ----- 5. Light / Dark: both render without errors -----
  log('5. Light / Dark theme — both render without errors...');
  const themes = ['light', 'dark'];
  for (const t of themes) {
    await page.evaluate((theme) => {
      localStorage.setItem('studykit.theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    }, t);
    await page.waitForFunction(
      (theme) => document.documentElement.getAttribute('data-theme') === theme,
      t,
      { timeout: 2000 },
    );
    // Re-assert node count is still ≥50 (re-render didn't
    // unmount the surface).
    const stillRendered = await page.locator('.react-flow__node').count();
    if (stillRendered < SEED_COUNT) {
      fail(`after theme=${t}: expected ≥${SEED_COUNT} nodes, got ${stillRendered}`);
    }
  }
  log('   Light + Dark both render ≥50 nodes.');

  // ----- 6. Outline path: real UI round-trip.
  //
  // Required DOM/UI assertions (master Gate: "outline
  // supports keyboard / screen readers"). The smoke
  // FAILS if any of these are not met:
  //   1. Pressing 'o' on the surface mounts the
  //      Outline view (a real `<section
  //      data-testid="cognitive-canvas-outline">`,
  //      not a Dexie write alone).
  //   2. The Outline exposes a `<ol role="tree">`
  //      with an accessible name and ≥50
  //      `role="treeitem"` rows (one per placement).
  //   3. Tab focus lands on a `role="treeitem"`
  //      (a real production affordance — the tree
  //      is keyboard-navigable).
  //   4. Pressing Enter on a treeitem flips its
  //      `aria-selected` to `true`.
  //   5. Clicking the Outline's
  //      `data-testid="cognitive-canvas-back-to-canvas"`
  //      button (or pressing 'o' on the Outline)
  //      calls `useCases.setViewMode` and the
  //      ReactFlow surface reappears with ≥50
  //      `.react-flow__node` elements.
  log('6. Outline path: real UI round-trip...');
  // 6.1 — focus the surface and press 'o'.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cognitive-canvas-flow"]');
    if (el) el.focus();
  });
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cognitive-canvas-flow"]');
    if (!el) return false;
    el.focus();
    const ev = new KeyboardEvent('keydown', {
      key: 'o', code: 'KeyO', bubbles: true, cancelable: true,
    });
    return el.dispatchEvent(ev);
  });
  // 6.2 — wait for the Outline view to mount.
  await page.waitForSelector('[data-testid="cognitive-canvas-outline"]', { timeout: 5000 });
  // The ReactFlow surface must be GONE while in
  // outline (the cognitive canvas's view branch
  // renders the outline OR the surface, not both).
  const surfaceDuringOutline = await page.locator('.react-flow__node').count();
  if (surfaceDuringOutline !== 0) {
    fail(`outline: surface should be hidden (0 .react-flow__node), got ${surfaceDuringOutline}`);
  }
  // 6.3 — the tree has ≥50 treeitem rows.
  await page.waitForSelector('[data-testid="cognitive-canvas-outline-tree"][role="tree"]', { timeout: 5000 });
  const tree = page.locator('[data-testid="cognitive-canvas-outline-tree"][role="tree"]');
  const treeAriaName = await tree.getAttribute('aria-label');
  if (!treeAriaName || !/outline/i.test(treeAriaName)) {
    fail(`outline: tree aria-label missing or wrong: ${JSON.stringify(treeAriaName)}`);
  }
  const treeItems = await tree.locator('[role="treeitem"]').count();
  log(`   outline treeitems: ${treeItems}`);
  if (treeItems < SEED_COUNT) {
    fail(`outline: expected ≥${SEED_COUNT} treeitems, got ${treeItems}`);
  }
  // 6.4 — Tab from the outline toolbar into the
  // tree lands on a real treeitem (the master Gate
  // "outline supports keyboard / screen readers").
  // First focus the toolbar's first button so the
  // Tab key walks forward into the tree.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="cognitive-canvas-back-to-canvas"]');
    if (btn) btn.focus();
  });
  // Tab once: should land on a treeitem (or the
  // "Back to canvas" button if its tabIndex is 0,
  // which it is). We assert EITHER an interactive
  // outline control OR a treeitem — both prove the
  // outline is keyboard-reachable.
  await page.keyboard.press('Tab');
  const tabFocus1 = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName,
      role: el.getAttribute('role'),
      testid: el.getAttribute('data-testid'),
      label: (el.getAttribute('aria-label') || '').slice(0, 60),
    };
  });
  log(`   first tab: ${JSON.stringify(tabFocus1)}`);
  // The Outline's first focusable child after the
  // back-to-canvas button is the first treeitem
  // (its `tabIndex={0}`). Keep tabbing until we
  // land on a treeitem OR run out (max 60 tabs to
  // walk through all 50 items + buttons).
  let landedOnTreeitem = tabFocus1?.role === 'treeitem';
  for (let i = 0; !landedOnTreeitem && i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return { role: el.getAttribute('role'), testid: el.getAttribute('data-testid') };
    });
    if (f?.role === 'treeitem') {
      landedOnTreeitem = true;
      break;
    }
  }
  if (!landedOnTreeitem) {
    fail('outline: Tab never landed on a role=treeitem');
  }
  log('   tab landed on a treeitem.');
  // 6.5 — pressing Enter on a treeitem flips
  // `aria-selected` to `true`. The selected treeitem
  // is the one currently focused.
  const beforeSelected = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return el.getAttribute('aria-selected');
  });
  log(`   treeitem aria-selected before Enter: ${beforeSelected}`);
  await page.keyboard.press('Enter');
  // The click handler updates the parent React
  // state synchronously; a single microtask is
  // enough.
  await sleep(50);
  const afterSelected = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return el.getAttribute('aria-selected');
  });
  log(`   treeitem aria-selected after Enter: ${afterSelected}`);
  if (afterSelected !== 'true') {
    fail(`outline: Enter on a treeitem did not set aria-selected=true (was ${beforeSelected} → ${afterSelected})`);
  }
  // 6.6 — return to spatial via the Outline's
  // accessible button. The button calls
  // `useCases.setViewMode({mode: 'spatial'})` and
  // the ReactFlow surface reappears with ≥50 nodes.
  await page.locator('[data-testid="cognitive-canvas-back-to-canvas"]').click({ timeout: 5000 });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length >= n,
    SEED_COUNT,
    { timeout: 5000 },
  );
  const backToSurface = await page.locator('.react-flow__node').count();
  log(`   back to spatial: ${backToSurface} .react-flow__node elements.`);
  if (backToSurface < SEED_COUNT) {
    fail(`outline round-trip: expected ≥${SEED_COUNT} nodes after Back to canvas, got ${backToSurface}`);
  }
  // The Outline must be gone.
  const outlineAfter = await page.locator('[data-testid="cognitive-canvas-outline"]').count();
  if (outlineAfter !== 0) {
    fail(`outline round-trip: Outline still mounted after Back to canvas (${outlineAfter})`);
  }
  log('   outline round-trip OK.');

  // ----- 7. Reload preserves view + placements -----
  log('7. Reload preserves the same view + ≥50 placements...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length >= n,
    SEED_COUNT,
    { timeout: 15_000 },
  );
  const reloadedNodeCount = await page.locator('.react-flow__node').count();
  if (reloadedNodeCount < SEED_COUNT) {
    fail(`after reload: expected ≥${SEED_COUNT} nodes, got ${reloadedNodeCount}`);
  }
  log(`   reloaded: ${reloadedNodeCount} nodes (persistence works).`);

  // ----- 8. FPS: real rAF for ≥2 s while causing genuine
  //  viewport interaction (continuous wheel + key
  //  pan/zoom). -----
  log(`8. Measuring real rAF throughput for ≥${FPS_WINDOW_MS} ms with continuous pan/zoom...`);
  const fpsResult = await page.evaluate(
    async ({ durationMs, viewportSelector }) => {
      // Locate the surface's React-Flow container; we
      // dispatch wheel + key events on it (the surface
      // listens for panOnDrag + the parent's window
      // keydown handler).
      const surface = document.querySelector('.react-flow');
      if (!surface) return { error: 'no surface' };
      // Get a handle for rAF + a frame counter.
      const start = performance.now();
      let frames = 0;
      const frameTimes = [];
      // Dispatch a continuous interaction: wheel
      // (zoom) and Ctrl+'=' / Ctrl+'-' (zoom) on a
      // 50 ms timer; the rAF loop counts frames.
      const stopAt = start + durationMs;
      let stopped = false;
      const tick = (now) => {
        if (stopped) return;
        frames += 1;
        frameTimes.push(now);
        if (now < stopAt) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // Interaction loop.
      const interact = () => {
        if (stopped) return;
        // Wheel event: a real `wheel` on the surface
        // (xyflow's `zoomOnScroll` default is on).
        surface.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 20, bubbles: true, cancelable: true,
          clientX: 640, clientY: 400,
        }));
        // Also fire a Ctrl+'+' / Ctrl+'-' window
        // keydown (parent's handler).
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }));
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }));
        }, 25);
      };
      const interactionInterval = setInterval(interact, 50);
      // Wait for the duration.
      await new Promise((r) => setTimeout(r, durationMs + 200));
      stopped = true;
      clearInterval(interactionInterval);
      const elapsed = performance.now() - start;
      return {
        elapsedMs: elapsed,
        frames,
        fps: (frames * 1000) / elapsed,
        env: {
          // `navigator.webdriver === true` is set by
          // headless Chromium. We report the raw value
          // so the smoke can be reproduced honestly.
          webdriver: !!navigator.webdriver,
        },
      };
    },
    { durationMs: FPS_WINDOW_MS, viewportSelector: '.react-flow' },
  );
  if (fpsResult.error) fail(`FPS measurement failed: ${fpsResult.error}`);
  log(`   elapsed: ${fpsResult.elapsedMs.toFixed(0)} ms`);
  log(`   frames:   ${fpsResult.frames}`);
  log(`   fps:      ${fpsResult.fps.toFixed(2)}`);
  log(`   env:      ${JSON.stringify(fpsResult.env)}`);

  // ----- 9. Console / page errors -----
  log('9. Console / pageerror checks...');
  if (pageErrors.length > 0) {
    fail(`page errors: ${pageErrors.join('; ')}`);
  }
  // console errors that survived the filter — the
  // filter is for known-noise; everything else is a
  // real bug.
  if (consoleErrors.length > 0) {
    fail(`console errors: ${consoleErrors.join('; ')}`);
  }
  log('   no page / console errors.');

  // ----- 10. Screenshot for the report -----
  log('10. Capturing screenshot...');
  await page.screenshot({ path: path.join(FRONTEND_DIR, 'canvas-smoke.png'), fullPage: true });
  log('   screenshot: canvas-smoke.png');

  // ----- Result -----
  const passed = fpsResult.fps >= FPS_GATE;
  log('');
  log(`=== Canvas smoke result: ${passed ? 'PASS' : 'PARTIAL'} ===`);
  log(`FPS gate: ${FPS_GATE}; measured: ${fpsResult.fps.toFixed(2)}; env: ${JSON.stringify(fpsResult.env)}`);
  log(`Rendered nodes: ${renderedNodeCount}; after reload: ${reloadedNodeCount}`);

  await browser.close();
  if (viteChild) { try { viteChild.kill('SIGTERM'); } catch (_) {} }
  process.exit(passed ? 0 : 3);
}

main().catch((err) => {
  console.error(`[smoke-canvas] FATAL: ${err && err.message ? err.message : err}`);
  process.exit(2);
});
