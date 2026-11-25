// Import-boundary guard for the v0.4 layering.
//
// Per `frontend/src/ARCHITECTURE.md` §1.3, `shared/` is the innermost
// UI/utility layer. It must not import from any business or platform
// layer. This test walks the TS source under `src/shared/` and fails
// if it finds an import that crosses an outward edge:
//
//   shared → domain | repositories | application | platforms |
//            features   | app          | components
//
// We intentionally do NOT add lint tooling for the other layers in
// this packet — the rule has to be enforceable for shared first,
// and the cost of false positives in features/ would be much
// higher. The other directions can adopt the same pattern in their
// own packets.
//
// Second guard (WP-02 Gate §3 blocker 5 + 6): the data gateway is
// the *only* place that knows about the v0.3 `/api` fetch clients.
// `components/` and `features/` must go through
// `application/dataApi`, never through `lib/api` or
// `lib/literature-api` directly. This prevents a UI click from
// silently hitting the network when the workspace flavour is
// `local`.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(here);
const componentsRoot = resolve(here, '..', '..', 'components');
const featuresRoot = resolve(here, '..', '..', 'features');
const appRoot = resolve(here, '..', '..', 'app');
const frontendRoot = resolve(here, '..', '..');

/** Layers that `shared/` must never import. */
const FORBIDDEN_LAYERS = [
  'domain',
  'repositories',
  'application',
  'platforms',
  'features',
  'app',
  'components',
];

/**
 * Modules that hold the v0.3 `/api` fetch clients. UI layers
 * must go through `application/dataApi` instead.
 */
const FORBIDDEN_DATA_SOURCES = ['lib/api', 'lib/literature-api', 'lib/literature-canvas-api'];

/** Recursively collect every .ts / .tsx file under a directory, INCLUDING
 *  test files. Skipping tests would let a violation slip in via a test
 *  helper or fixture, which defeats the boundary contract. */
function walk(dir: string, out: string[] = []): string[] {
  let exists = true;
  try { statSync(dir); } catch { exists = false; }
  if (!exists) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (s.isFile() && /\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  importPath: string;
  reason: string;
}

function findLayerViolations(root: string, layers: string[]): Violation[] {
  const files = walk(root);
  const violations: Violation[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const re = /\bimport(?:\s+type)?\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/g;
      const dyn = /\bimport\(\s*['"]([^'"]+)['"]/g;
      const matches: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) matches.push(m[1]);
      while ((m = dyn.exec(line))) matches.push(m[1]);
      for (const imp of matches) {
        if (!imp.startsWith('.')) continue;
        const target = resolve(dirname(file), imp);
        const rel = relative(frontendRoot, target).split(/[\\/]+/);
        const offending = rel.find((seg) => layers.includes(seg));
        if (offending) {
          violations.push({
            file: relative(frontendRoot, file),
            line: i + 1,
            importPath: imp,
            reason: `forbidden layer: ${offending}`,
          });
        }
      }
    }
  }
  return violations;
}

function findDataSourceViolations(roots: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const root of roots) {
    const files = walk(root);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const re = /\bimport(?:\s+type)?\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/g;
        const dyn = /\bimport\(\s*['"]([^'"]+)['"]/g;
        const matches: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) matches.push(m[1]);
        while ((m = dyn.exec(line))) matches.push(m[1]);
        for (const imp of matches) {
          if (!imp.startsWith('.')) continue;
          const target = resolve(dirname(file), imp);
          const rel = relative(frontendRoot, target).split(/[\\/]+/);
          // The forbidden data source is identified by the path
          // segment after `lib/`, e.g. `lib/api` or
          // `lib/literature-api`.
          const relStr = rel.join('/');
          const offending = FORBIDDEN_DATA_SOURCES.find(
            (ds) => relStr.includes(`lib/${ds.replace(/^lib\//, '')}`),
          );
          if (offending) {
            violations.push({
              file: relative(frontendRoot, file),
              line: i + 1,
              importPath: imp,
              reason: `direct /api client import (use application/dataApi instead)`,
            });
          }
        }
      }
    }
  }
  return violations;
}

describe('shared/ import boundaries', () => {
  it('does not import from domain, repositories, application, platforms, features, app, or components', () => {
    const violations = findLayerViolations(sharedRoot, FORBIDDEN_LAYERS);
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  → ${v.importPath}  (${v.reason})`)
        .join('\n');
      throw new Error(`shared/ must not reach into outer layers:\n${msg}`);
    }
    expect(violations).toEqual([]);
  });
});

describe('UI layers (components/, features/, app/) import-boundary', () => {
  it('does not import the v0.3 /api fetch clients directly — go through application/dataApi', () => {
    const violations = findDataSourceViolations([componentsRoot, featuresRoot, appRoot]);
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  → ${v.importPath}  (${v.reason})`)
        .join('\n');
      throw new Error(
        `UI layers must route data through application/dataApi, not the raw /api clients:\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
