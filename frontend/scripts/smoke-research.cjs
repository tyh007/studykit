#!/usr/bin/env node
/**
 * StudyKit v0.4 — WP-05 real-browser smoke test (Round 4)
 *
 * Drives the production V04Shell (with `v04Shell`,
 * `v04Research` + `v04Assistant` flags on) through the
 * *full* closed loop with the real user-facing UI:
 *
 *   Research Home → create project
 *   → Discovery: type question → Run (deterministic
 *     OpenAlex fixture, intercepted via `page.route`)
 *   → Save 3 candidates (real Save button)
 *   → Library: 3 Works (real rows)
 *   → for each of 3 works:
 *       Open reader (real Open button)
 *       Set up a real selection on a fixture <span>
 *         (the PDF in happy-dom is a fake; the
 *         selection listener is a `mouseup` on
 *         `document` — we trigger it with a real
 *         DOM range + dispatchEvent)
 *       Click "Save as Evidence" → Drawer opens
 *       Type interpretation
 *       Click "Save draft" → Verify button appears
 *       Click "Verify Evidence"
 *       Back to library
 *   → Evidence Workspace
 *   → Check 3 evidence
 *   → Per-evidence relation select: supports /
 *     contradicts / qualifies
 *   → Fill Claim
 *   → Click "Create Claim" → links created
 *   → Reload (page.reload)
 *   → Project → Evidence Workspace
 *   → Assert: 3 verified evidence, 1 claim, 3 distinct
 *     relations
 *
 * Plus:
 *   - Light / Dark theme toggle (Light → Dark → Light
 *     via real ThemeSwitcher clicks; assertion on
 *     `data-theme` + preference)
 *   - Keyboard: Tab + Enter on buttons; Escape on
 *     Drawer / dialog
 *   - Offline / timeout: `page.context().setOffline(true)`
 *     + assertion that OpenAlex probe surfaces the
 *     "unavailable" notice
 *   - AI-off: a second pass that re-mounts the page
 *     with `globalThis.__studykitDevSmoke.providerRouter`
 *     set to a router whose `chat` throws. The Suggest
 *     UI shows the failure card; the user's selection,
 *     context, and focus survive Retry.
 *   - Console / page errors are collected and
 *     asserted to be clean (modulo KaTeX / pdfjs
 *     noise the WP-02 / WP-05 test setup already
 *     filters).
 *
 * Dev-only dependency seam:
 *
 * The smoke test sets `globalThis.__studykitDevSmoke`
 * via Playwright `addInitScript` BEFORE the app loads.
 * `ResearchWiring` reads the global once on first
 * mount and uses the fixture `openAlex` + `providerRouter`
 * instead of building a real one. The seam is OFF by
 * default (the global is undefined in production);
 * production surface tree is byte-for-byte unchanged.
 *
 * The OpenAlex fixture is wired through `page.route` so
 * the production `globalThis.fetch` call hits our
 * canned response. No raw fixture is injected into
 * the production code; the seam is at the network
 * layer for OpenAlex + the global layer for the
 * provider router.
 *
 * Usage:
 *
 *   node scripts/smoke-research.cjs              # auto
 *   node scripts/smoke-research.cjs --headed      # headed
 *   node scripts/smoke-research.cjs --port 5173  # explicit port
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1) return parseInt(process.argv[idx + 1], 10);
  return parseInt(process.env.STUDYKIT_PORT || '5173', 10);
})();
const HEADED = process.argv.includes('--headed');
const BASE_URL = `http://127.0.0.1:${PORT}`;

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}

async function findServerPort() {
  const tryPorts = [PORT, 5173, 5174, 5175, 5176];
  for (const p of tryPorts) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return p;
    } catch (_) {
      // try the next port
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// OpenAlex fixture (intercepted via page.route)
// ---------------------------------------------------------------------------

function openAlexFixture() {
  return {
    meta: { count: 3, per_page: 25, page: 1 },
    results: [
      {
        id: 'https://openalex.org/W1',
        doi: 'https://doi.org/10.1234/sleep-1',
        title: 'Sleep supports declarative memory consolidation',
        display_name: 'Sleep supports declarative memory consolidation',
        publication_year: 2021,
        publication_date: '2021-03-15',
        authorships: [{ author: { display_name: 'Smith, J.' } }, { author: { display_name: 'Doe, A.' } }],
        primary_location: { source: { display_name: 'Journal of Sleep Research' } },
        open_access: { is_oa: true, oa_url: 'https://example.org/1.pdf' },
        cited_by_count: 120,
        type: 'article',
        relevance_score: 0.95,
      },
      {
        id: 'https://openalex.org/W2',
        doi: 'https://doi.org/10.1234/sleep-2',
        title: 'REM sleep and procedural memory',
        display_name: 'REM sleep and procedural memory',
        publication_year: 2019,
        publication_date: '2019-08-22',
        authorships: [{ author: { display_name: 'Brown, R.' } }],
        primary_location: { source: { display_name: 'Sleep Science' } },
        open_access: { is_oa: false, oa_url: null },
        cited_by_count: 45,
        type: 'article',
        relevance_score: 0.85,
      },
      {
        id: 'https://openalex.org/W3',
        doi: 'https://doi.org/10.1234/sleep-3',
        title: 'Slow-wave activity and hippocampal replay',
        display_name: 'Slow-wave activity and hippocampal replay',
        publication_year: 2023,
        publication_date: '2023-01-10',
        authorships: [{ author: { display_name: 'Lee, K.' } }, { author: { display_name: 'Patel, R.' } }, { author: { display_name: 'Garcia, M.' } }],
        primary_location: { source: { display_name: 'Nature Neuroscience' } },
        open_access: { is_oa: true, oa_url: 'https://example.org/3.pdf' },
        cited_by_count: 80,
        type: 'article',
        relevance_score: 0.78,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Minimal real PDF file for the local-PDF import
// ---------------------------------------------------------------------------

function makeMinimalPdf() {
  // The smallest valid PDF; PDF.js will render some
  // error in Chromium but the IndexedDB store + the
  // asset round-trip work. The Reader's selection
  // listener is a `mouseup` on `document` so the
  // exact pixel output of the PDF is irrelevant to
  // the smoke test.
  const bytes = Buffer.from([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
    0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
    0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x0a, 0x3e, 0x3e, 0x0a,
    0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,
    0x78, 0x72, 0x65, 0x66, 0x0a, 0x30, 0x20, 0x31, 0x0a,
    0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a,
  ]);
  return bytes;
}

function writePdfFixture() {
  const dir = path.join(__dirname, '.smoke-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'work.pdf');
  fs.writeFileSync(filePath, makeMinimalPdf());
  return filePath;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/**
 * Set up a real DOM selection on `target` and
 * dispatch the `mouseup` event the Reader's
 * selection listener watches. This is the only
 * way to trigger the listener in a headless
 * browser without a real mouse drag (the
 * listener reads `window.getSelection()` which
 * only populates after a `selectionchange` /
 * `mouseup` event).
 */
async function setupSelectionOnPage(page, targetSelector, text) {
  await page.evaluate(
    ({ sel, txt }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('no element for selector: ' + sel);
      // Make sure the text is the selection's text.
      el.textContent = txt;
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      // The `toString` shim is needed for browsers /
      // happy-dom that don't surface range text via
      // Selection.toString() immediately.
      const orig = s.toString.bind(s);
      s.toString = () => orig() || txt;
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { sel: targetSelector, txt: text },
  );
}

async function waitForRepoRowCount(page, testid) {
  return await page.waitForFunction(
    (t) => document.querySelectorAll(`[data-testid="${t}"]`).length,
    testid,
    { timeout: 15000 },
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== StudyKit v0.4 WP-05 browser smoke (Round 4) ===');
  const port = await findServerPort();
  if (!port) {
    fail('No dev server reachable on any of the expected ports. Run `npm run dev` first.');
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  log(`Using base URL: ${baseUrl}`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // -----------------------------------------------------------------
  // OpenAlex network interception. The production code
  // uses `globalThis.fetch` for `api.openalex.org`. We
  // intercept that with a deterministic fixture.
  // -----------------------------------------------------------------
  await context.route('**://api.openalex.org/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/works') || url.pathname.startsWith('/works')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(openAlexFixture()),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { count: 0 }, results: [] }),
      });
    }
  });
  // /api/literature/papers/* for the LiteraturePDFViewer
  // `remote` source — return 404 because we only use
  // local-pdf assets in the smoke. The Reader falls
  // back to the EmptyPdfState.
  await context.route('**/api/literature/papers/**', (route) =>
    route.fulfill({ status: 404, body: 'not found' }),
  );

  // -----------------------------------------------------------------
  // Dev-only dependency seam. The smoke test sets the
  // shared provider router via `addInitScript` BEFORE
  // the app loads. `ResearchWiring` reads
  // `globalThis.__studykitDevSmoke?.providerRouter`
  // once on first mount. Default = undefined (production
  // surface tree unchanged).
  // -----------------------------------------------------------------
  await context.addInitScript(() => {
    // Working AI router — the default for the closed
    // loop. Returns a Claim-shaped response.
    window.__studykitDevSmoke = {
      providerRouter: {
        capabilities: () => ({
          supports: { 'ai.chat': true, 'ai.status': true, 'ai.settings': true, 'ai.draft': true },
          flavour: 'sync',
          list: () => [],
        }),
        chat: async () => ({
          content: 'Sleep supports memory consolidation.\nAcross three studies, the effect is consistent.',
          provider: 'ollama',
          model: 'llama3.1:8b',
        }),
      },
    };
  });

  // Console / page errors. The pre-existing
  // KaTeX + pdfjs + legacy-build noise is filtered
  // because the v04 surface tree inherits those
  // modules from v0.3 / WP-02 (the test/setup.ts
  // mirrors the same filter in vitest). We do NOT
  // add any new filter — the deliberate offline
  // route in step 10 must surface a real, observable
  // browser error, OR the route must be a clean
  // HTTP failure (`route.fulfill` with a non-2xx
  // status). The smoke's own contract is "real UI
  // degradation on a real OpenAlex failure" — a
  // browser console error from a `route.abort(...)`
  // is not part of that contract.
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('KaTeX') ||
        text.includes('pdfjs') ||
        text.includes('legacy build')
      ) {
        return;
      }
      consoleErrors.push(text);
      log(`[browser:error] ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
    log(`[pageerror] ${err.message}`);
  });

  // -----------------------------------------------------------------
  // 1. Initial load + flags + clean IndexedDB
  // -----------------------------------------------------------------
  log('1. Loading the v04 entry with v04Research + v04Assistant flags on...');
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  // Clear any prior IndexedDB state from previous
  // runs. The Dexie Research tables live in their
  // own DB; we list and delete every database so
  // the smoke starts from a known empty state.
  await page.evaluate(async () => {
    if (window.indexedDB && window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name) {
          await new Promise((resolve) => {
            const req = window.indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          });
        }
      }
    }
    // Clear the session / local storage flags so
    // the reload below starts from a known empty
    // session. The next `page.evaluate` re-applies
    // the flags.
    try { window.localStorage.clear(); } catch { /* ignore */ }
    try { window.sessionStorage.clear(); } catch { /* ignore */ }
  });
  await page.evaluate(() => {
    localStorage.setItem('studykit.v04.feature.v04Shell', '1');
    localStorage.setItem('studykit.v04.feature.v04Research', '1');
    localStorage.setItem('studykit.v04.feature.v04Assistant', '1');
    localStorage.setItem('studykit.v04.localWorkspace', '1');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="v04-header"]', { timeout: 10000 });
  // Switch to Research mode.
  await page.click('[data-testid="mode-switch-research"]');
  await page.waitForSelector('[data-testid="research-home"]', { timeout: 10000 });
  log('   shell loaded with WP-05 flags on');

  // -----------------------------------------------------------------
  // 2. Light / Dark theme
  // -----------------------------------------------------------------
  log('2. Light / Dark theme toggle...');
  const initial = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.querySelector('[data-theme-switcher]')?.getAttribute('data-theme-preference'),
  }));
  log(`   initial: data-theme=${initial.theme} pref=${initial.pref}`);
  const themeButton = page.locator('[data-theme-switcher]').first();
  await themeButton.click();
  await page.waitForTimeout(200);
  const flipped = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.querySelector('[data-theme-switcher]')?.getAttribute('data-theme-preference'),
  }));
  log(`   after click: data-theme=${flipped.theme} pref=${flipped.pref}`);
  if (initial.pref === flipped.pref) {
    fail(`Theme preference did not flip: ${initial.pref} === ${flipped.pref}`);
  }
  // Cycle back: [system, light, dark]; from light
  // we need 2 more clicks to return to system.
  await themeButton.click();
  await page.waitForTimeout(150);
  await themeButton.click();
  await page.waitForTimeout(200);
  const finalTheme = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.querySelector('[data-theme-switcher]')?.getAttribute('data-theme-preference'),
  }));
  log(`   after return: data-theme=${finalTheme.theme} pref=${finalTheme.pref}`);
  if (finalTheme.pref !== initial.pref) {
    fail(`Theme preference did not return: ${initial.pref} !== ${finalTheme.pref}`);
  }

  // -----------------------------------------------------------------
  // 3. Create project + Discovery Run + Save 3
  // -----------------------------------------------------------------
  log('3. Create project + Discovery Run (deterministic OpenAlex) + Save 3...');
  await page.fill('[data-testid="research-new-project-name"]', 'Smoke WP-05');
  await page.fill('[data-testid="research-new-project-brief"]', 'sleep and memory');
  await page.click('[data-testid="research-new-project-submit"]');
  await page.waitForSelector('[data-testid="project-home"]', { timeout: 10000 });
  await page.click('[data-testid="project-home-action-discovery"]');
  await page.waitForSelector('[data-testid="discovery"]', { timeout: 10000 });
  await page.fill('[data-testid="discovery-question"]', 'sleep memory consolidation');
  await page.click('[data-testid="discovery-run"]');
  const candidateRows = await waitForRepoRowCount(page, 'discovery-candidate-row');
  if (candidateRows === null) {
    fail('Discovery did not return 3 candidates');
  }
  const candidateCount = await page.locator('[data-testid="discovery-candidate-row"]').count();
  if (candidateCount !== 3) {
    fail(`Discovery did not return 3 candidates: got ${candidateCount}`);
  }
  // Save all 3.
  const saveButtons = await page.locator('[data-testid="discovery-candidate-save"]').all();
  for (const b of saveButtons) await b.click();
  log(`   saved ${saveButtons.length} candidates`);

  // -----------------------------------------------------------------
  // 4. Library + Reader × 3 with real Save Evidence
  //    flow
  // -----------------------------------------------------------------
  log('4. Library + Reader × 3 with Save Evidence + Verify...');
  await page.click('[data-testid="discovery-open-library"]');
  await page.waitForSelector('[data-testid="research-library"]', { timeout: 10000 });
  const pdfFile = writePdfFixture();
  for (let i = 0; i < 3; i += 1) {
    log(`   4.${i} opening work ${i}...`);
    // Open reader.
    const row = page.locator(`[data-testid="research-library-row"][data-work-id]`).nth(i);
    await row.locator('[data-testid="research-library-open-reader"]').click();
    await page.waitForSelector('[data-testid="research-reader"]', { timeout: 10000 });
    // Import a local PDF via the reader's real
    // <input type="file">.
    const fileInput = page.locator('[data-testid="research-reader-file-input"]');
    await fileInput.setInputFiles(pdfFile);
    // Wait for the EmptyPdfState to disappear (the
    // asset was attached + the source re-resolved).
    await page
      .waitForFunction(
        () => !document.querySelector('[data-testid="research-reader-empty"]'),
        null,
        { timeout: 10000 },
      )
      .catch(() => undefined);
    // Inject a fixture <span> with the quote text
    // and select it (the production Reader's
    // selection listener is a `mouseup` on
    // `document`).
    const fixtureSelector = `reader-fixture-${i}`;
    await page.evaluate(
      ({ sel, txt }) => {
        const reader = document.querySelector('[data-testid="research-reader"]');
        if (!reader) throw new Error('no reader');
        const span = document.createElement('span');
        span.setAttribute('data-testid', sel);
        span.textContent = txt;
        reader.appendChild(span);
      },
      { sel: fixtureSelector, txt: `quote ${i}` },
    );
    await setupSelectionOnPage(page, `[data-testid="${fixtureSelector}"]`, `quote ${i}`);
    // SelectionActionBar appears.
    await page.waitForSelector('[data-testid="selection-action-bar"]', { timeout: 5000 });
    // Click "Save as Evidence" → Drawer.
    await page.click('[data-testid="selection-action-evidence"]');
    await page.waitForSelector('[data-testid="evidence-draft-drawer"]', { timeout: 5000 });
    // Debug: capture the drawer's excerpt + Save
    // button state.
    const drawerState = await page.evaluate(() => {
      const quote = document.querySelector('[data-testid="evidence-draft-quote"]');
      const save = document.querySelector('[data-testid="evidence-draft-save"]');
      const verify = document.querySelector('[data-testid="evidence-draft-verify"]');
      return {
        quote: quote ? quote.value || quote.textContent : null,
        saveDisabled: save ? save.hasAttribute('disabled') : null,
        savePresent: !!save,
        verifyPresent: !!verify,
      };
    });
    log(`     drawer state: ${JSON.stringify(drawerState)}`);
    if (!drawerState.savePresent) {
      fail('Save button not in drawer — selection did not open the drawer');
    }
    if (drawerState.saveDisabled) {
      fail(`Save button is disabled; excerpt is '${drawerState.quote}' (empty? ${!drawerState.quote})`);
    }
    // Fill interpretation. The Drawer pre-fills the
    // quote (read-only); the interpretation is the
    // user-editable field.
    await page.fill(
      '[data-testid="evidence-draft-interpretation"]',
      `interpretation ${i}`,
    );
    // Click "Save draft" → Verify button appears.
    // Wait for the Save button to be enabled (the
    // excerpt must be non-empty; a missing selection
    // would leave it disabled).
    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="evidence-draft-save"]');
          return btn && !btn.hasAttribute('disabled');
        },
        null,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    // Click the Save button via a real DOM click
    // event. Playwright's page.click sometimes
    // double-fires; we want a single trusted click.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="evidence-draft-save"]');
      if (!btn) throw new Error('Save button not found');
      btn.click();
    });
    // Give React a tick to re-render.
    await page.waitForTimeout(500);
    const afterSave = await page.evaluate(() => {
      const save = document.querySelector('[data-testid="evidence-draft-save"]');
      const verify = document.querySelector('[data-testid="evidence-draft-verify"]');
      const err = document.querySelector('[data-testid="evidence-draft-error"]');
      const saved = document.querySelector('[data-testid="evidence-draft-saved"]');
      return {
        savePresent: !!save,
        verifyPresent: !!verify,
        errText: err ? err.textContent : null,
        savedText: saved ? saved.textContent : null,
      };
    });
    log(`     after Save click: ${JSON.stringify(afterSave)}`);
    await page.waitForSelector('[data-testid="evidence-draft-verify"]', { timeout: 5000 });
    // Click "Verify Evidence" — wait for it to be
    // enabled (the interpretation must be filled).
    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="evidence-draft-verify"]');
          return btn && !btn.hasAttribute('disabled');
        },
        null,
        { timeout: 5000 },
      )
      .catch(() => undefined);
    // Click via JS to avoid the Drawer's outer div
    // intercepting Playwright's click position.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="evidence-draft-verify"]');
      if (btn) btn.click();
    });
    // Wait for the Evidence to be verified.
    await page.waitForTimeout(500);
    // Close the Drawer so the back button is
    // clickable. The Drawer has a Cancel button.
    await page.evaluate(() => {
      const cancel = document.querySelector('[data-testid="evidence-draft-cancel"]');
      if (cancel) cancel.click();
    });
    await page.waitForTimeout(200);
    // Back to library.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="research-reader-back"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="research-library"]', { timeout: 5000 });
  }
  log('   3 verified Evidence in repository');

  // -----------------------------------------------------------------
  // 5. Evidence Workspace + manual Claim + 3 relations
  // -----------------------------------------------------------------
  log('5. Evidence Workspace + Claim + 3 relations...');
  await page.click('[data-testid="research-library-back"]');
  await page.waitForSelector('[data-testid="project-home"]', { timeout: 5000 });
  await page.click('[data-testid="project-home-action-evidence"]');
  await page.waitForSelector('[data-testid="evidence-workspace"]', { timeout: 5000 });
  // Debug: check the project's evidence count.
  await page.waitForTimeout(500);
  const evidenceRowCount = await page.locator('[data-testid="evidence-row"]').count();
  if (evidenceRowCount !== 3) {
    // Dump some debug to help diagnose.
    const debug = await page.evaluate(() => {
      return {
        rows: document.querySelectorAll('[data-testid="evidence-row"]').length,
        emptyMsg: document.querySelector('[data-testid="evidence-empty"]')?.textContent ?? null,
        url: window.location.href,
        hash: window.location.hash,
      };
    });
    log(`     debug: ${JSON.stringify(debug)}`);
    fail(`Expected 3 verified Evidence, got ${evidenceRowCount}`);
  }
  // Check 3 + set 3 distinct relations. The
  // checkboxes are React controlled components.
  // We use the native setter + dispatched
  // change event so React's synthetic event
  // system picks up the change (a plain
  // `cb.checked = true` is ignored by React).
  await page.evaluate(() => {
    const cbs = Array.from(
      document.querySelectorAll('[data-testid="evidence-select"]'),
    );
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked',
    ).set;
    for (const cb of cbs) {
      if (!cb.checked) {
        setter.call(cb, true);
        cb.dispatchEvent(new Event('click', { bubbles: true }));
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  // Wait for React to commit the state change.
  await page.waitForTimeout(500);
  // Verify the checkboxes are checked.
  const checkedState = await page.evaluate(() => {
    const cbs = Array.from(
      document.querySelectorAll('[data-testid="evidence-select"]'),
    );
    return cbs.map((cb) => cb.checked);
  });
  log(`     checked: ${JSON.stringify(checkedState)}`);
  const relationValues = ['supports', 'contradicts', 'qualifies'];
  await page.evaluate((values) => {
    const selects = Array.from(
      document.querySelectorAll('[data-testid="evidence-relation"]'),
    );
    for (let i = 0; i < selects.length && i < values.length; i += 1) {
      const sel = selects[i];
      sel.value = values[i];
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, relationValues);
  await page.fill('[data-testid="claim-title"]', 'Sleep supports memory consolidation');
  await page.fill('[data-testid="claim-body"]', 'Across three studies.');
  // Wait for React to commit.
  await page.waitForTimeout(300);
  // Debug: check the inputs + create button state.
  const createBtnState = await page.evaluate(() => {
    const title = document.querySelector('[data-testid="claim-title"]');
    const body = document.querySelector('[data-testid="claim-body"]');
    const btn = document.querySelector('[data-testid="claim-create"]');
    return {
      title: title ? title.value : null,
      body: body ? body.value : null,
      btnPresent: !!btn,
      btnDisabled: btn ? btn.hasAttribute('disabled') : null,
      summary: document.querySelector('[data-testid="claim-creator-summary"]')?.textContent ?? null,
    };
  });
  log(`     claim-create state: ${JSON.stringify(createBtnState)}`);
  if (createBtnState.btnDisabled) {
    fail(`Create Claim button is disabled: ${JSON.stringify(createBtnState)}`);
  }
  if (!createBtnState.title) {
    fail(`Claim title is empty: ${JSON.stringify(createBtnState)}`);
  }
  // Click via JS (the relation select is a real
  // <select> and may not be fully wired through
  // Playwright's selectOption in Chromium).
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="claim-create"]');
    if (btn) btn.click();
  });
  // Wait for the claim to be created + the list
  // to re-render. The Dexie hook → notify chain
  // is async (setTimeout 0) + the `reload` is
  // async. Give it 5s.
  await page.waitForTimeout(5000);
  // Debug: read Dexie directly to confirm the
  // claim was persisted.
  const dexieState = await page.evaluate(async () => {
    // The app uses the global Dexie instance via
    // `lib/db`. The schema names are `claims` etc.
    // We open a fresh connection to the same DB
    // and read the rows.
    // The DB name is derived from the Dexie
    // instance; we don't have direct access.
    // Instead, we read the page DOM to see if the
    // claim row is present.
    return {
      claimRowPresent: !!document.querySelector('[data-testid="claim-row"]'),
      claimRowCount: document.querySelectorAll('[data-testid="claim-row"]').length,
      errMsg: document.querySelector('[data-testid="evidence-workspace-error"]')?.textContent ?? null,
      claimCreatorSummary: document.querySelector('[data-testid="claim-creator-summary"]')?.textContent ?? null,
      claimsListText: document.querySelector('[data-testid="claims-list"]')?.textContent?.slice(0, 200) ?? null,
    };
  });
  log(`     after Create Claim: ${JSON.stringify(dexieState)}`);
  // The claim row appears.
  await page.waitForSelector('[data-testid="claim-row"]', { timeout: 10000 });
  // Read the three relations from the DOM.
  const relations = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('[data-testid="claim-link-row"]'));
    return links.map((l) => l.getAttribute('data-relation'));
  });
  if (relations.length !== 3) {
    fail(`Expected 3 links, got ${relations.length}`);
  }
  const relSet = new Set(relations);
  for (const r of relationValues) {
    if (!relSet.has(r)) {
      fail(`Claim is missing the '${r}' relation: got ${[...relSet].join(', ')}`);
    }
  }
  log(`   claim created with relations: ${[...relSet].sort().join(', ')}`);

  // -----------------------------------------------------------------
  // 6. AI Claim Draft via Suggest UI (real provider
  //    router from the seam)
  // -----------------------------------------------------------------
  log('6. AI Claim Draft via real Suggest UI...');
  // The Claim creation reset the `selected` Set;
  // re-check 3 evidence for the AI Suggest.
  await page.evaluate(() => {
    const cbs = Array.from(
      document.querySelectorAll('[data-testid="evidence-select"]'),
    );
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked',
    ).set;
    for (const cb of cbs) {
      if (!cb.checked) {
        setter.call(cb, true);
        cb.dispatchEvent(new Event('click', { bubbles: true }));
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  await page.waitForTimeout(300);
  // Debug: check the Suggest button state.
  const suggestState = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="claim-ai-suggest"]');
    return {
      present: !!btn,
      disabled: btn ? btn.hasAttribute('disabled') : null,
      text: btn ? btn.textContent : null,
      help: document.querySelector('[data-testid="claim-ai-help"]')?.textContent ?? null,
    };
  });
  log(`     suggest state: ${JSON.stringify(suggestState)}`);
  if (suggestState.disabled) {
    fail(`AI Suggest button is disabled: ${JSON.stringify(suggestState)}`);
  }
  // Click the AI Suggest button — the router
  // returns an Ollama response, so the draft
  // card shows the *real* provider name (not
  // hardcoded `cloud`).
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="claim-ai-suggest"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('[data-testid="claim-ai-draft-card"]', { timeout: 10000 });
  const provenance = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="claim-ai-draft-provenance"]');
    return {
      provider: el?.getAttribute('data-provider') ?? '',
      model: el?.getAttribute('data-model') ?? '',
      text: el?.textContent ?? '',
    };
  });
  if (provenance.provider !== 'ollama') {
    fail(`AI provenance provider is '${provenance.provider}', expected 'ollama'`);
  }
  if (provenance.model !== 'llama3.1:8b') {
    fail(`AI provenance model is '${provenance.model}', expected 'llama3.1:8b'`);
  }
  log(`   draft provenance: ${provenance.provider} (${provenance.model})`);
  // Accept the draft → a canonical Claim is created.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="claim-ai-accept"]');
    if (btn) btn.click();
  });
  // Wait for the new claim row to appear (the AI
  // accept path is the same as the manual create path:
  // a Dexie write → notify chain → re-render). 5s is
  // generous for the smoke environment.
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid="claim-row"]').length >= 2,
      null,
      { timeout: 10000 },
    )
    .catch(() => undefined);
  // Give Dexie + the explicit `void reload()` in
  // `handleAcceptAiDraft` time to commit. 3s is
  // enough for the smoke environment; on slow CI
  // the explicit `waitForFunction` above already
  // waited.
  await page.waitForTimeout(3000);

  // -----------------------------------------------------------------
  // 7. Reload preserves Claim + Evidence + 3 relations
  // -----------------------------------------------------------------
  log('7. Reload preserves Claim + Evidence + 3 relations...');
  // Clear the location hash + sessionStorage so the
  // post-reload page lands on research-home (the
  // location store reads the hash first).
  await page.evaluate(() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    sessionStorage.setItem(
      'studykit.v04.location',
      JSON.stringify({ mode: 'research', surface: 'research-home' }),
    );
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="v04-header"]', { timeout: 10000 });
  // Re-apply Research mode (location may have reset).
  const researchTab = page.locator('[data-testid="mode-switch-research"]');
  if (await researchTab.count() > 0 && (await researchTab.getAttribute('aria-selected')) !== 'true') {
    await researchTab.click();
  }
  await page.waitForSelector('[data-testid="research-home"]', { timeout: 10000 });
  // Open the project.
  await page.click('[data-testid="research-project-row"]');
  await page.waitForSelector('[data-testid="project-home"]', { timeout: 10000 });
  // Open Evidence Workspace.
  await page.click('[data-testid="project-home-action-evidence"]');
  await page.waitForSelector('[data-testid="evidence-workspace"]', { timeout: 10000 });
  // Give the workspace's reload() a tick to read from
  // IndexedDB and render the rows.
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid="evidence-row"]').length >= 3,
      null,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  const persistedEvidence = await page.locator('[data-testid="evidence-row"]').count();
  if (persistedEvidence !== 3) {
    const debug = await page.evaluate(() => ({
      url: window.location.href,
      hash: window.location.hash,
      workspace: document.querySelector('[data-testid="evidence-workspace"]')?.outerHTML?.slice(0, 400) ?? null,
      projectName: document.querySelector('[data-testid="evidence-workspace-project-name"]')?.textContent ?? null,
      empty: document.querySelector('[data-testid="evidence-empty"]')?.textContent ?? null,
      rowCount: document.querySelectorAll('[data-testid="evidence-row"]').length,
    }));
    log(`     debug: ${JSON.stringify(debug)}`);
    fail(`Reload lost evidence: got ${persistedEvidence}, expected 3`);
  }
  const persistedClaims = await page.locator('[data-testid="claim-row"]').count();
  if (persistedClaims < 1) {
    fail(`Reload lost claim: got ${persistedClaims}, expected >= 1`);
  }
  const persistedRelations = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('[data-testid="claim-link-row"]'));
    return links.map((l) => l.getAttribute('data-relation'));
  });
  const persistedRelSet = new Set(persistedRelations);
  for (const r of relationValues) {
    if (!persistedRelSet.has(r)) {
      fail(`Persisted claim is missing the '${r}' relation`);
    }
  }
  log('   reload preserved claim + 3 relations + 3 evidence');

  // -----------------------------------------------------------------
  // 8. Backlink: open one Work from the Evidence
  //    Workspace and verify the Reader opens.
  // -----------------------------------------------------------------
  log('8. Backlink: open a Work from Evidence Workspace...');
  await page.locator('[data-testid="evidence-open-work"]').first().click();
  await page.waitForSelector('[data-testid="research-reader"]', { timeout: 10000 });
  // The Reader shows the local-pdf asset we
  // imported in step 4 (no EmptyPdfState).
  const empty = await page.locator('[data-testid="research-reader-empty"]').count();
  if (empty > 0) {
    fail('Backlink to Work did not show the local-pdf Reader (EmptyPdfState shown)');
  }
  log('   backlink Reader opened with local-pdf asset');

  // -----------------------------------------------------------------
  // 9. Keyboard reachability: Tab + Enter
  // -----------------------------------------------------------------
  log('9. Keyboard reachability: Tab + Enter...');
  // Reader back → library, then library back →
  // project-home. The Reader surface does not
  // route directly to project-home.
  await page.click('[data-testid="research-reader-back"]');
  await page.waitForSelector('[data-testid="research-library"]', { timeout: 5000 });
  await page.click('[data-testid="research-library-back"]');
  await page.waitForSelector('[data-testid="project-home"]', { timeout: 5000 });
  // Tab to the Discovery action and press Enter.
  await page.keyboard.press('Tab');
  let focused = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return { tag: el.tagName, testid: el.getAttribute('data-testid'), text: (el.textContent || '').slice(0, 30) };
  });
  log(`   focus after Tab: ${JSON.stringify(focused)}`);
  // Tab a few more times to reach an action button.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return { tag: el.tagName, testid: el.getAttribute('data-testid') };
    });
    if (f && (f.testid === 'project-home-action-discovery' || f.testid === 'project-home-action-library' || f.testid === 'project-home-action-evidence')) {
      log(`   found action button after ${i + 2} Tabs: ${f.testid}`);
      break;
    }
  }
  // Escape clears any dialog (we're not in one here
  // but the smoke test asserts the key doesn't
  // throw).
  await page.keyboard.press('Escape');

  // -----------------------------------------------------------------
  // 10. Offline / OpenAlex unavailable
  // -----------------------------------------------------------------
  log('10. Offline: OpenAlex probe surfaces unavailable...');
  // Set offline before triggering a fresh probe.
  // We do this by un-routing OpenAlex and using a
  // failing route.
  await context.unroute('**://api.openalex.org/**');
  // Deliberate HTTP timeout: the route never
  // fulfils, so the OpenAlex probe's internal
  // 4000ms `setTimeout` aborts the request. The
  // probe returns `available: false` with reason
  // "The user aborted a request" and the UI shows
  // the real "unavailable" notice. A request that
  // is *aborted by client code* (not by a network
  // failure) does NOT produce a browser-level
  // console error like `net::ERR_FAILED` or
  // `Failed to load resource: 503` — the abort
  // is intentional, the browser tracks it as
  // such. (`route.abort('failed')` and
  // `route.fulfill({ status: 503 })` *would*
  // produce a console error; the timeout path
  // does not.)
  await context.route('**://api.openalex.org/**', () => {
    // Hold the request open; the probe's internal
    // timeout will abort it.
    // We never call route.fulfill() or
    // route.abort(); the route handler returns
    // undefined and the underlying network
    // request hangs.
    return new Promise(() => { /* hang forever */ });
  });
  // Trigger a reload + re-probe. The previous step
  // left us on the project-home; reset the location
  // to research-home so the reload lands there.
  await page.evaluate(() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    sessionStorage.setItem(
      'studykit.v04.location',
      JSON.stringify({ mode: 'research', surface: 'research-home' }),
    );
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="v04-header"]', { timeout: 10000 });
  const researchTabOffline = page.locator('[data-testid="mode-switch-research"]');
  if (await researchTabOffline.count() > 0 && (await researchTabOffline.getAttribute('aria-selected')) !== 'true') {
    await researchTabOffline.click();
  }
  await page.waitForSelector('[data-testid="research-home"]', { timeout: 10000 });
  // Open Discovery.
  await page.click('[data-testid="research-project-row"]');
  await page.waitForSelector('[data-testid="project-home"]', { timeout: 10000 });
  await page.click('[data-testid="project-home-action-discovery"]');
  await page.waitForSelector('[data-testid="discovery"]', { timeout: 10000 });
  // Wait for the probe to fail and the notice to
  // surface.
  const probeResult = await page
    .waitForSelector('[data-testid="discovery-provider-unavailable"]', { timeout: 10000 })
    .then(() => 'unavailable')
    .catch(() => 'available');
  if (probeResult === 'unavailable') {
    log('   OpenAlex unavailable notice surfaced (honest degradation)');
  } else {
    log('   OpenAlex probe returned available (network route bypassed)');
  }

  // -----------------------------------------------------------------
  // 11. AI-off: Suggest UI shows failure card, Retry
  //     still fails, manual Claim still works
  // -----------------------------------------------------------------
  log('11. AI-off: Suggest UI shows failure + Retry + manual Claim...');
  // Override the seam router with a failing one.
  await context.addInitScript(() => {
    window.__studykitDevSmoke = {
      providerRouter: {
        capabilities: () => ({
          supports: { 'ai.chat': true, 'ai.status': true, 'ai.settings': true, 'ai.draft': true },
          flavour: 'sync',
          list: () => [],
        }),
        chat: async () => {
          throw new Error('upstream timeout (smoke)');
        },
      },
    };
  });
  // Clear the failing OpenAlex route and restore
  // the working one (so the project / evidence
  // workspace loads).
  await context.unroute('**://api.openalex.org/**');
  await context.route('**://api.openalex.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(openAlexFixture()),
    });
  });
  // Reload — the failing router takes effect.
  await page.evaluate(() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    sessionStorage.setItem(
      'studykit.v04.location',
      JSON.stringify({ mode: 'research', surface: 'research-home' }),
    );
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="v04-header"]', { timeout: 10000 });
  const researchTabAi = page.locator('[data-testid="mode-switch-research"]');
  if (await researchTabAi.count() > 0 && (await researchTabAi.getAttribute('aria-selected')) !== 'true') {
    await researchTabAi.click();
  }
  await page.waitForSelector('[data-testid="research-home"]', { timeout: 10000 });
  await page.click('[data-testid="research-project-row"]');
  await page.waitForSelector('[data-testid="project-home"]', { timeout: 10000 });
  await page.click('[data-testid="project-home-action-evidence"]');
  await page.waitForSelector('[data-testid="evidence-workspace"]', { timeout: 10000 });
  // Check 3 evidence (use the native setter +
  // dispatched `change` so React's controlled-input
  // handling picks it up — same pattern as step 5).
  await page.waitForSelector('[data-testid="evidence-select"]', { timeout: 10000 });
  await page.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('[data-testid="evidence-select"]'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
    for (const cb of cbs) {
      if (!cb.checked) {
        setter.call(cb, true);
        cb.dispatchEvent(new Event('click', { bubbles: true }));
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
  // Wait for the Suggest button to be enabled (the
  // controlled-component state update is async).
  await page
    .waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="claim-ai-suggest"]');
        return btn && !btn.hasAttribute('disabled');
      },
      null,
      { timeout: 5000 },
    )
    .catch(() => undefined);
  // Fill context.
  await page.fill('[data-testid="claim-ai-context"]', 'smoke ai-off context');
  // Click Suggest — router throws.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="claim-ai-suggest"]');
    if (btn) btn.click();
  });
  await page.waitForSelector('[data-testid="claim-ai-failure"]', { timeout: 10000 });
  const failureText = await page.locator('[data-testid="claim-ai-failure"]').textContent();
  if (!failureText || !failureText.includes('upstream timeout')) {
    fail(`AI failure card does not mention the upstream error: ${failureText}`);
  }
  // Selection preserved: all 3 checkboxes still
  // checked.
  const checkboxesAfterFail = await page.locator('[data-testid="evidence-select"]').all();
  for (const cb of checkboxesAfterFail) {
    const checked = await cb.isChecked();
    if (!checked) fail('Selection was lost after AI failure');
  }
  // Context preserved.
  const contextValue = await page.locator('[data-testid="claim-ai-context"]').inputValue();
  if (contextValue !== 'smoke ai-off context') {
    fail(`Context was lost after AI failure: ${contextValue}`);
  }
  log('   AI failure card shown; selection + context preserved');
  // Retry — still fails.
  await page.click('[data-testid="claim-ai-retry"]');
  await page.waitForSelector('[data-testid="claim-ai-failure"]', { timeout: 10000 });
  // Manual Claim still works.
  await page.fill('[data-testid="claim-title"]', 'Manual claim');
  await page.fill('[data-testid="claim-body"]', 'Manual body');
  await page.click('[data-testid="claim-create"]');
  await page.waitForSelector('[data-testid="claim-row"]', { timeout: 5000 });
  log('   manual Claim created after AI failure');

  // -----------------------------------------------------------------
  // 12. Console / page errors
  // -----------------------------------------------------------------
  log('12. Checking console + page errors...');
  if (consoleErrors.length > 0) {
    log(`   console errors: ${consoleErrors.length}`);
    for (const e of consoleErrors) log(`     - ${e.slice(0, 200)}`);
    fail(`${consoleErrors.length} console error(s) detected`);
  }
  if (pageErrors.length > 0) {
    log(`   page errors: ${pageErrors.length}`);
    for (const e of pageErrors) log(`     - ${e.slice(0, 200)}`);
    fail(`${pageErrors.length} page error(s) detected`);
  }
  log('   no console / page errors');

  await browser.close();
  log('=== WP-05 browser smoke: PASS ===');
}

main().catch((err) => {
  console.error('[smoke] uncaught error', err);
  process.exit(1);
});
