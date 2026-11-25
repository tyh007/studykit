// Verifies the CSS contract for the theme runtime:
//   - The stylesheet MUST contain both [data-theme="light"] and
//     [data-theme="dark"] blocks so explicit preferences are honored.
//   - The stylesheet MUST still contain the prefers-color-scheme fallback
//     so users who never pick a theme get a sensible default.
//   - The two blocks MUST override the same semantic tokens (so components
//     can be theme-agnostic).
//
// We don't actually paint the page in this test — happy-dom has no layout
// engine. We just regex-parse the stylesheet to assert the contract.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../styles/liquid-glass.css');

describe('theme CSS contract (liquid-glass.css)', () => {
  const css = readFileSync(cssPath, 'utf8');

  it('declares an explicit [data-theme="dark"] block', () => {
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
  });

  it('declares an explicit [data-theme="light"] block', () => {
    expect(css).toMatch(/\[data-theme="light"\]\s*\{/);
  });

  it('keeps the prefers-color-scheme system fallback', () => {
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  });

  it('re-asserts the same semantic tokens under each explicit theme', () => {
    // Slice out the explicit [data-theme="dark"] block, then look for the
    // canonical tokens inside. The list is intentionally short — these
    // are the tokens every primitive consumes today.
    const darkBlock = css.match(/\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/);
    expect(darkBlock).toBeTruthy();
    for (const token of ['--bg-base', '--primary', '--text', '--surface-elevated', '--border-glass']) {
      expect(darkBlock![0], `dark block must define ${token}`).toContain(token);
    }
    const lightBlock = css.match(/\[data-theme="light"\]\s*\{[\s\S]*?\n\}/);
    expect(lightBlock).toBeTruthy();
    for (const token of ['--bg-base', '--primary', '--text', '--surface-elevated', '--border-glass']) {
      expect(lightBlock![0], `light block must define ${token}`).toContain(token);
    }
  });

  it('exposes the new subtle / border tokens used by the v0.4 primitives', () => {
    for (const block of [/\[data-theme="dark"\]\s*\{[\s\S]*?\n\}/, /\[data-theme="light"\]\s*\{[\s\S]*?\n\}/]) {
      const m = css.match(block);
      expect(m, `expected block matching ${block}`).toBeTruthy();
      for (const token of ['--success-subtle', '--success-border', '--warning-subtle', '--warning-border', '--error-subtle', '--error-border', '--error-glow']) {
        expect(m![0], `${block} must define ${token}`).toContain(token);
      }
    }
  });
});
