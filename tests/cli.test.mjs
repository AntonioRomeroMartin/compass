// Pruebas de la CLI contra repos git temporales (remoto + dos clones): `node --test tests/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../cli/compass.mjs', import.meta.url).pathname;

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'compass-cli-'));
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  for (const name of ['a', 'b']) {
    git(dir, 'clone', '-q', 'remote.git', name);
    git(join(dir, name), 'config', 'user.email', 'test@example.com');
    git(join(dir, name), 'config', 'user.name', 'test');
    git(join(dir, name), 'checkout', '-q', '-B', 'main');
  }
  const doc = { version: 1, timeZone: 'UTC', categories: ['Gym'], goals: [] };
  writeFileSync(join(dir, 'a', 'goals.json'), JSON.stringify(doc, null, 2) + '\n');
  git(join(dir, 'a'), 'add', '.');
  git(join(dir, 'a'), 'commit', '-qm', 'init');
  git(join(dir, 'a'), 'push', '-q', '-u', 'origin', 'main');
  git(join(dir, 'b'), 'pull', '-q', 'origin', 'main');
  git(join(dir, 'b'), 'branch', '-q', '--set-upstream-to=origin/main');
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ repo: join(dir, 'a'), goals: 'goals.json' }));
  /** @param {...string} args */
  const run = (...args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, COMPASS_CONFIG: config } });
  /** @param {string} name */
  const read = (name) => JSON.parse(readFileSync(join(dir, name, 'goals.json'), 'utf8'));
  return { dir, run, read };
}

test('add, inc y done escriben con commit y push', () => {
  const { dir, run } = setup();
  run('goal', 'add', '--title', 'Strength sessions', '--category', 'Gym', '--horizon', 'week', '--target', '4');
  run('goal', 'inc', 'strength', '2');
  const out = run('today');
  assert.match(out, /Strength sessions — 2\/4 · week · Gym/);
  git(join(dir, 'b'), 'pull', '-q');
  const doc = JSON.parse(readFileSync(join(dir, 'b', 'goals.json'), 'utf8'));
  assert.equal(Object.values(doc.goals[0].progress)[0], 2);
  assert.match(git(join(dir, 'b'), 'log', '-1', '--format=%s'), /^goals: progress “Strength sessions”/);
});

test('si otro dispositivo escribe a la vez, se reaplica encima sin perder nada', () => {
  const { dir, run, read } = setup();
  run('goal', 'add', '--title', 'Read', '--category', 'Books', '--horizon', 'month', '--target', '3');
  // Un hook pre-push simula que el otro clon sube un cambio justo antes de nuestro push.
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
  assert.equal(Object.values(doc.goals[0].progress)[0], 1);
});

test('referencias ambiguas o inexistentes fallan sin escribir', () => {
  const { run, read } = setup();
  run('goal', 'add', '--title', 'Run 5k', '--category', 'Gym', '--horizon', 'week');
  run('goal', 'add', '--title', 'Run 10k', '--category', 'Gym', '--horizon', 'month');
  assert.throws(() => run('goal', 'inc', 'run'), /several goals/);
  assert.throws(() => run('goal', 'inc', 'swim'), /no goal matches/);
  assert.deepEqual(read('a').goals.map((/** @type {any} */ g) => g.progress), [{}, {}]);
});

test('period da las claves en la zona del archivo', () => {
  const { run } = setup();
  const keys = JSON.parse(run('period', '2027-01-01'));
  assert.equal(keys.week, '2026-W53');
  assert.equal(run('period', '2026-10-23', '--days', '2026-11-01').trim(), '9');
});
