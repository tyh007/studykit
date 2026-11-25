import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIB = 1024;
const ENTRY_GZIP_BUDGET = 300 * KIB;
const ROUTE_GZIP_BUDGET = 300 * KIB;
const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const entryMatch = html.match(/<script[^>]+src="\.?([/]assets[/][^"]+[.]js)"/u);

if (!entryMatch) {
  throw new Error('WP-11 bundle gate: production entry script was not found. Run npm run build first.');
}

const assetsDirectory = new URL('assets/', dist);
const names = (await readdir(assetsDirectory)).filter((name) => name.endsWith('.js'));
const measurements = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(join(fileURLToPath(assetsDirectory), name));
    return { name, raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength };
  }),
);
const entryName = entryMatch[1].split('/').at(-1);
const entry = measurements.find((item) => item.name === entryName);

if (!entry) {
  throw new Error(`WP-11 bundle gate: entry asset ${entryName} is missing.`);
}

const failures = [];
if (entry.gzip > ENTRY_GZIP_BUDGET) {
  failures.push(`entry ${entry.name} is ${(entry.gzip / KIB).toFixed(1)} KiB gzip (budget 300 KiB)`);
}
for (const item of measurements) {
  if (item.name !== entry.name && item.gzip > ROUTE_GZIP_BUDGET) {
    failures.push(`route ${item.name} is ${(item.gzip / KIB).toFixed(1)} KiB gzip (budget 300 KiB)`);
  }
}

const largest = measurements
  .toSorted((a, b) => b.gzip - a.gzip)
  .slice(0, 8)
  .map((item) => `${item.name}: ${(item.gzip / KIB).toFixed(1)} KiB gzip`);

console.log(`WP-11 bundle gate: entry ${entry.name} ${(entry.gzip / KIB).toFixed(1)} KiB gzip`);
console.log(`Largest chunks:\n- ${largest.join('\n- ')}`);

if (failures.length > 0) {
  throw new Error(`WP-11 performance budget failed:\n- ${failures.join('\n- ')}`);
}
