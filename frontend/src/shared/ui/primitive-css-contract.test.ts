// CSS contract test for the v0.4 shared primitives section.
//
// The v0.4 primitive CSS in src/index.css is the contract layer for
// theme switching: it must consume semantic tokens (`var(--*)`)
// only, so that `[data-theme]` blocks and the legacy `@media`
// fallback both produce the right colors without any component
// having to know about light vs dark.
//
// This test scans ONLY the WP-01 section (the block that starts
// with the "v0.4 Shared UI Primitives (WP-01)" header) and asserts
// it contains no hex literals and no rgba() literals. Legacy CSS
// above that header is intentionally untouched and is not part of
// this contract.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../index.css');

const START_MARKER = 'v0.4 Shared UI Primitives (WP-01)';

function extractWp01Section(css: string): string {
  const start = css.indexOf(START_MARKER);
  if (start < 0) {
    throw new Error(`Could not find ${START_MARKER} marker in index.css`);
  }
  return css.slice(start);
}

describe('WP-01 primitive CSS contract', () => {
  const section = extractWp01Section(readFileSync(cssPath, 'utf8'));

  it('contains no hex color literals', () => {
    const m = section.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(m, `WP-01 section must be token-only; found: ${m?.join(', ')}`).toBeNull();
  });

  it('contains no rgba() literals', () => {
    const m = section.match(/rgba\(/g);
    expect(m, 'WP-01 section must consume --*-subtle/border tokens instead of inline rgba()').toBeNull();
  });

  it('consumes the new subtle / border tokens (smoke)', () => {
    for (const token of ['--success-subtle', '--warning-subtle', '--error-subtle', '--error-glow']) {
      expect(section, `expected WP-01 CSS to reference ${token}`).toContain(token);
    }
  });
});
