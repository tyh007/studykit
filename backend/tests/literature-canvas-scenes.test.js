const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('literature canvas scenes schema and API routes are declared', () => {
  const root = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'routes', 'literature-canvas.js'), 'utf8');

  assert.match(schema, /CREATE TABLE IF NOT EXISTS literature_canvas_scenes/);
  assert.match(schema, /idx_lit_canvas_scenes_canvas/);

  assert.match(route, /router\.get\('\/:canvasId\/scenes'/);
  assert.match(route, /router\.post\('\/:canvasId\/scenes'/);
  assert.match(route, /router\.patch\('\/:canvasId\/scenes\/:sceneId'/);
  assert.match(route, /router\.delete\('\/:canvasId\/scenes\/:sceneId'/);
});
