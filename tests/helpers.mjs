// Shared setup for the CLI tests: a bare "remote" and two clones (a, b) of a data repo.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../cli/compass.mjs', import.meta.url).pathname;

/** @param {string} cwd @param {string[]} args */
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * @param {Record<string, unknown>} [files]  initial data files (name → JSON)
 */
export function setup(files = { 'goals.json': { version: 1, timeZone: 'UTC', categories: ['Sport'], goals: [] } }) {
  const dir = mkdtempSync(join(tmpdir(), 'compass-cli-'));
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  for (const name of ['a', 'b']) {
    git(dir, 'clone', '-q', 'remote.git', name);
    git(join(dir, name), 'config', 'user.email', 'test@example.com');
    git(join(dir, name), 'config', 'user.name', 'test');
    git(join(dir, name), 'checkout', '-q', '-B', 'main');
  }
  writeFileSync(join(dir, 'a', 'README.md'), 'data\n');
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(dir, 'a', name), JSON.stringify(doc, null, 2) + '\n');
  git(join(dir, 'a'), 'add', '.');
  git(join(dir, 'a'), 'commit', '-qm', 'init');
  git(join(dir, 'a'), 'push', '-q', '-u', 'origin', 'main');
  git(join(dir, 'b'), 'pull', '-q', 'origin', 'main');
  git(join(dir, 'b'), 'branch', '-q', '--set-upstream-to=origin/main');
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ repo: join(dir, 'a'), goals: 'goals.json' }));
  /** @param {...string} args */
  const run = (...args) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, COMPASS_CONFIG: config } });
  /** Like run, but also returns stderr (and does not throw). @param {...string} args */
  const runAll = (...args) => {
    const res = spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, COMPASS_CONFIG: config } });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  };
  /** @param {string} clone @param {string} [file] */
  const read = (clone, file = 'goals.json') => {
    const path = join(dir, clone, file);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  };
  return { dir, run, runAll, read };
}
