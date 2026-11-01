// @ts-check
// The service worker's SHELL list (what the app keeps to open offline) must hold every file the app loads: the
// page's own files and every module reachable from app/app.js. Nothing else checks it, and a missing file only
// shows when the app is opened offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');

/** Paths in SHELL, relative to the root ('./' is the page itself). */
function shell() {
  const list = /const SHELL = \[([\s\S]*?)\];/.exec(read('sw.js'));
  assert.ok(list, 'sw.js has a SHELL list');
  return [...list[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
}

/** Local files the page names (scripts, styles, manifest, icons). */
function pageFiles() {
  return [...read('index.html').matchAll(/(?:src|href)="(?!https?:|#|data:)\.?\/?([^"]+)"/g)].map((m) => m[1]);
}

/** Every module reachable from a start file through static and dynamic imports. @param {string} start */
function modules(start) {
  const seen = new Set();
  const todo = [start];
  while (todo.length) {
    const file = /** @type {string} */ (todo.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)'(\.{1,2}\/[^']+)'/gm)) {
      todo.push(relative(root, normalize(join(root, dirname(file), m[1]))));
    }
  }
  return [...seen];
}

test('sw: SHELL lists every file the app loads, and only files that exist', () => {
  const listed = new Set(shell());
  for (const p of listed) assert.ok(existsSync(join(root, p)), `${p} is in SHELL but does not exist`);
  for (const p of [...pageFiles(), ...modules('app/app.js')]) assert.ok(listed.has(p), `${p} is loaded by the app but missing from SHELL in sw.js`);
});
