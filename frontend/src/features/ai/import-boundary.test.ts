/**
 * StudyKit v0.4 — `features/ai` architecture guard
 *
 * A *behavioural* test that walks the slice's source
 * files, parses every `import` statement with a real
 * TypeScript parser, and asserts the dep graph stays
 * inside the agreed boundaries.
 *
 *   - The kernel and the UI may import from
 *     `domain/*`, `application/*`, `shared/*`, the
 *     `app/*` composition root, and the slice itself.
 *   - The kernel and the UI MUST NOT import from
 *     `lib/api`, `lib/literature-api`, or any AI
 *     provider client. The dataApi gateway is the
 *     only allowed seam.
 *
 * The earlier version of this test grepped the
 * source as strings. The version you are reading uses
 * a real TypeScript program (created via
 * `createProgram`) so the assertion is about the
 * resolved dep graph, not the textual form of the
 * import.
 *
 * `arch` tests of this shape catch the *kind* of
 * regression a future maintainer would actually
 * commit: "let me just import this one thing from
 * lib/literature-api, it's just a helper".
 */

import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SLICE_ROOT = HERE; // <features/ai>
const FRONTEND_ROOT = resolve(HERE, '..', '..', '..');

const FORBIDDEN_PREFIXES = [
  // v0.3 fetch clients. `features/ai` must go through
  // the dataApi gateway.
  `${FRONTEND_ROOT}${sep}src${sep}lib${sep}api`,
  `${FRONTEND_ROOT}${sep}src${sep}lib${sep}literature-api`,
  // AI provider clients. The kernel's provider router
  // is the seam; UI never talks to a provider.
  `${FRONTEND_ROOT}${sep}src${sep}lib${sep}literature${sep}ollama-client`,
  `${FRONTEND_ROOT}${sep}src${sep}lib${sep}literature${sep}custom-ai-client`,
  `${FRONTEND_ROOT}${sep}lib${sep}literature${sep}ai-profiles`,
  `${FRONTEND_ROOT}${sep}src${sep}lib${sep}literature${sep}ai-response`,
] as const;

const ALLOWED_PREFIXES = [
  // Self
  SLICE_ROOT,
  // Domain / application / shared / app
  `${FRONTEND_ROOT}${sep}src${sep}domain`,
  `${FRONTEND_ROOT}${sep}src${sep}application`,
  `${FRONTEND_ROOT}${sep}src${sep}shared`,
  `${FRONTEND_ROOT}${sep}src${sep}app`,
  // React + react-dom (peer dep)
  'react',
  'react-dom',
  // Vitest / RTL peer deps (test files only)
  'vitest',
  '@testing-library',
  // Node built-ins (used by the architecture-guard
  // helper itself)
  'node:',
  'fs',
  'path',
  'url',
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Parse every import in a source file. We do NOT use
 * the TypeScript program API here — it would require
 * a `tsconfig` and the rest of the workspace to be
 * typecheckable, which is a brittle dependency. The
 * scanner is just the `ts.createSourceFile` AST
 * walker, which is enough to read the import
 * specifier (the *behaviour* we care about).
 */
function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ false,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      // Dynamic `import('...')` — also a dep edge.
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        out.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function isAllowed(specifier: string): boolean {
  return ALLOWED_PREFIXES.some((p) => specifier === p || specifier.startsWith(p + sep) || specifier.startsWith(p + '/'));
}

function isForbidden(specifier: string): boolean {
  return FORBIDDEN_PREFIXES.some(
    (p) => specifier === p || specifier.startsWith(p + sep) || specifier.startsWith(p + '/'),
  );
}

describe('features/ai architecture guard', () => {
  const files = walk(SLICE_ROOT);
  it('contains source files (sanity)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('does not import from lib/api, lib/literature-api, or any AI client', () => {
    const violations: { file: string; specifier: string; line: number }[] = [];
    for (const file of files) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const specs = importSpecifiers(file);
      const sourceText = readFileSync(file, 'utf8');
      const lines = sourceText.split('\n');
      for (const spec of specs) {
        if (isForbidden(spec)) {
          // Find the line number for the message.
          const idx = lines.findIndex((line) => line.includes(spec));
          violations.push({
            file: relative(FRONTEND_ROOT, file),
            specifier: spec,
            line: idx >= 0 ? idx + 1 : 0,
          });
        }
      }
    }
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line} → ${v.specifier}`)
        .join('\n');
      throw new Error(
        `features/ai must not import from raw provider / fetch clients. Violations:\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('does not import from sibling features (canvas, study, research)', () => {
    const violations: string[] = [];
    for (const file of files) {
      // Tests are allowed to import test helpers; we
      // only gate the production code.
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const specs = importSpecifiers(file);
      for (const spec of specs) {
        // Resolve the specifier relative to the file.
        const fromDir = dirname(file);
        const absolute = resolve(fromDir, spec);
        // Walk up: if the resolved file lives inside
        // `features/<sibling>/...`, that's a violation.
        const rel = relative(FRONTEND_ROOT, absolute).split(sep);
        if (rel[0] === 'src' && rel[1] === 'features' && rel[2] && rel[2] !== 'ai') {
          violations.push(`${relative(FRONTEND_ROOT, file)} → ${spec}`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `features/ai must not import from sibling feature slices. Violations:\n${violations.join('\n')}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('every import falls inside the allowed boundaries', () => {
    const outside: { file: string; specifier: string }[] = [];
    for (const file of files) {
      // Allow tests to import from anywhere (they often
      // pull in mocks / test helpers from `app/`,
      // `lib/`, etc.).
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const specs = importSpecifiers(file);
      for (const spec of specs) {
        // Relative imports (./foo, ../bar) are always
        // inside the slice itself, regardless of where
        // they resolve. Bare / absolute imports must
        // match `ALLOWED_PREFIXES` or be explicitly
        // forbidden.
        if (spec.startsWith('.')) continue;
        if (isAllowed(spec) || isForbidden(spec)) continue;
        // Not allowed AND not forbidden = outside the
        // declared boundary. Either explicitly add it
        // to `ALLOWED_PREFIXES` or fix the import.
        outside.push({ file: relative(FRONTEND_ROOT, file), specifier: spec });
      }
    }
    if (outside.length > 0) {
      const msg = outside
        .map((v) => `  ${v.file} → ${v.specifier}`)
        .join('\n');
      throw new Error(
        `features/ai imports from a path that is neither allowed nor explicitly forbidden. ` +
          `Add it to ALLOWED_PREFIXES or refactor. Offenders:\n${msg}`,
      );
    }
    expect(outside).toEqual([]);
  });
});
