// CLI tests against temporary git repos (remote + two clones): `node --test tests/*.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, setup } from './helpers.mjs';

test('add, inc and done write with commit and push', () => {
  const { dir, run } = setup();
  run('goal', 'add', '--title', 'Strength sessions', '--category', 'Sport', '--horizon', 'week', '--target', '4');
  run('goal', 'inc', 'strength', '2');
  const out = run('today');
  assert.match(out, /Strength sessions — 2\/4 · week · Sport/);
  git(join(dir, 'b'), 'pull', '-q');
  const doc = JSON.parse(readFileSync(join(dir, 'b', 'goals.json'), 'utf8'));
  assert.equal(doc.goals[0].progress, 2);
  assert.match(git(join(dir, 'b'), 'log', '-1', '--format=%s'), /^goals: progress “Strength sessions”/);
});

test('if another device writes at the same time, it is re-applied on top without losing anything', () => {
  const { dir, run, read } = setup();
  run('goal', 'add', '--title', 'Read', '--category', 'Reading', '--horizon', 'month', '--target', '3');
  // A pre-push hook simulates the other clone pushing a change right before our push.
  const b = join(dir, 'b');
  const hook = join(dir, 'a', '.git', 'hooks', 'pre-push');
  writeFileSync(hook, `#!/bin/sh
[ -f "${dir}/fired" ] && exit 0
touch "${dir}/fired"
cd "${b}" && git pull -q && node -e '
const fs = require("fs"); const d = JSON.parse(fs.readFileSync("goals.json", "utf8"));
d.goals[0].notes = "from b"; fs.writeFileSync("goals.json", JSON.stringify(d, null, 2) + "\\n");' && git commit -qam race && git push -q
exit 0
`);
  chmodSync(hook, 0o755);
  run('goal', 'inc', 'read');
  git(b, 'pull', '-q');
  const doc = read('b');
  assert.equal(doc.goals[0].notes, 'from b');
  assert.equal(doc.goals[0].progress, 1);
});

test('ambiguous or missing references fail without writing', () => {
  const { run, read } = setup();
  run('goal', 'add', '--title', 'Run 5k', '--category', 'Sport', '--horizon', 'week');
  run('goal', 'add', '--title', 'Run 10k', '--category', 'Sport', '--horizon', 'month');
  assert.throws(() => run('goal', 'inc', 'run'), /several goals/);
  assert.throws(() => run('goal', 'inc', 'swim'), /no goal matches/);
  assert.deepEqual(read('a').goals.map((/** @type {any} */ g) => g.progress), [0, 0]);
});

test('period gives the keys in the file\'s zone', () => {
  const { run } = setup();
  const keys = JSON.parse(run('period', '2027-01-01'));
  assert.equal(keys.week, '2026-W53');
  assert.equal(run('period', '2026-10-23', '--days', '2026-11-01').trim(), '9');
});
