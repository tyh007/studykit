// The bootstrap script that index.html runs in <head> is a hand-synced
// copy of src/shared/theme/bootstrapScript.ts. This test loads the
// index.html file and asserts the two stay in sync — if a future
// contributor edits one without the other, this fails fast.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { bootstrapScript } from './bootstrapScript';

const here = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = resolve(here, '../../../index.html');

function normalize(src: string): string {
  // Collapse whitespace; we only care that the script body matches.
  return src.replace(/\s+/g, ' ').trim();
}

describe('theme bootstrap script sync', () => {
  it('index.html contains a copy of the bootstrapScript that matches', () => {
    const html = readFileSync(indexHtmlPath, 'utf8');
    const m = html.match(/<script>\s*\/\/ v0\.4 Theme bootstrap[\s\S]*?<\/script>/);
    expect(m, 'expected to find the bootstrap <script> block in index.html').toBeTruthy();
    // Extract just the IIFE body — drop the leading comment for comparison.
    const body = m![0]
      .replace(/<script>/, '')
      .replace(/<\/script>/, '')
      .replace(/^\s*\/\/ v0\.4 Theme bootstrap[\s\S]*?\(function \(\) \{/, '(function () {')
      .trim();
    expect(normalize(body)).toBe(normalize(bootstrapScript));
  });
});
