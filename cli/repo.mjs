// @ts-check
// CLI access to the data: a local git checkout of the data repo.
//
// Same model as the app: "the whole document" is never saved, only operations that are
// applied on top of the latest version. If the push fails because the remote changed, the
// local commit is undone, the remote is pulled again and the operations are re-applied on top.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * @typedef {Object} Config
 * @property {string} repo     path of the local checkout of the data repo
 * @property {string} goals    path of goals.json inside the repo
 * @property {string} tasks    path of tasks.json inside the repo
 * @property {string} domains  path of domains.json inside the repo
 * @property {string} habits   path of habits.json inside the repo
 */

const CONFIG_PATH = process.env.COMPASS_CONFIG ?? join(homedir(), '.config', 'compass', 'config.json');
export const NET_TIMEOUT = 20000;
const LOCAL_TIMEOUT = 10000;

/** @returns {Config} */
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`No config at ${CONFIG_PATH}. Create it with: {"repo": "/path/to/data-repo", "goals": "goals.json"}`);
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (typeof raw.repo !== 'string' || !raw.repo) throw new Error(`"repo" missing in ${CONFIG_PATH}`);
  return {
    repo: resolve(raw.repo.replace(/^~(?=$|\/)/, homedir())),
    goals: raw.goals ?? 'goals.json',
    tasks: raw.tasks ?? 'tasks.json',
    domains: raw.domains ?? 'domains.json',
    habits: raw.habits ?? 'habits.json',
  };
}

/**
 * @param {Config} cfg
 * @param {string[]} args
 * @param {number} [timeout]
 */
function git(cfg, args, timeout = NET_TIMEOUT) {
  return execFileSync('git', ['-C', cfg.repo, ...args], {
    encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

/**
 * Brings in the latest from the remote. Without network, or if it takes longer than `timeout`,
 * it warns in one line and continues with the local copy. Only the fetch can time out: the
 * rebase is local, so it is never cut half-way.
 * @param {Config} cfg
 * @param {number} [timeout]  ms for the network part
 * @returns {boolean} whether syncing succeeded
 */
export function pull(cfg, timeout = NET_TIMEOUT) {
  try {
    git(cfg, ['fetch', '--quiet'], timeout);
  } catch (e) {
    const timedOut = /** @type {any} */ (e).code === 'ETIMEDOUT';
    console.error(`warning: could not pull (${timedOut ? `no answer in ${timeout / 1000} s` : firstLine(e)}); using the local copy`);
    return false;
  }
  try {
    git(cfg, ['rebase', '--autostash', '--quiet', '@{upstream}'], LOCAL_TIMEOUT);
    return true;
  } catch (e) {
    try {
      git(cfg, ['rebase', '--abort'], LOCAL_TIMEOUT);
    } catch {
      // There was no rebase in progress.
    }
    console.error(`warning: could not update the local copy (${firstLine(e)}); using it as it is`);
    return false;
  }
}

/**
 * @param {Config} cfg
 * @param {string} rel
 */
export function readJson(cfg, rel) {
  return JSON.parse(readFileSync(join(cfg.repo, rel), 'utf8'));
}

/**
 * Like readJson, but a file that does not exist yet is null.
 * @param {Config} cfg
 * @param {string} rel
 */
export function readJsonIfExists(cfg, rel) {
  return existsSync(join(cfg.repo, rel)) ? readJson(cfg, rel) : null;
}

/**
 * Applies `change` to the current version of one file, commits only that file and pushes.
 * @param {Config} cfg
 * @param {string} rel
 * @param {(doc: any) => { text: string, message: string } | null} change
 * @param {{ sync: boolean }} opts
 * @returns {{ pushed: boolean, message: string | null }}
 */
export function commitChange(cfg, rel, change, opts) {
  return commitFiles(cfg, [rel], (docs) => {
    const result = change(docs[rel]);
    return result && { files: { [rel]: result.text }, message: result.message };
  }, opts);
}

/**
 * Applies `change` to the current versions of several files and writes them in ONE commit
 * (e.g. a task and the goal it adds to), then pushes. `change` receives the freshly read
 * documents (null for a file that does not exist yet: it is created) and returns the new
 * texts of the files it changes and the commit message, or null if nothing changed.
 * If the push is rejected because the remote moved, the commit is undone (those files only),
 * the remote is pulled and `change` runs again on the new versions.
 * @param {Config} cfg
 * @param {string[]} rels
 * @param {(docs: Record<string, any>) => { files: Record<string, string>, message: string } | null} change
 * @param {{ sync: boolean }} opts
 * @returns {{ pushed: boolean, message: string | null }}
 */
export function commitFiles(cfg, rels, change, opts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (opts.sync && attempt > 1) pull(cfg);
    /** @type {Record<string, string | null>} */
    const before = {};
    /** @type {Record<string, any>} */
    const docs = {};
    for (const rel of rels) {
      const path = join(cfg.repo, rel);
      before[rel] = existsSync(path) ? readFileSync(path, 'utf8') : null;
      docs[rel] = before[rel] === null ? null : JSON.parse(/** @type {string} */ (before[rel]));
    }
    const result = change(docs);
    const changed = result ? rels.filter((rel) => typeof result.files[rel] === 'string' && result.files[rel] !== before[rel]) : [];
    if (!result || !changed.length) return { pushed: false, message: null };
    for (const rel of changed) {
      const path = join(cfg.repo, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, result.files[rel]);
    }
    git(cfg, ['add', '--', ...changed], LOCAL_TIMEOUT);
    git(cfg, ['commit', '--quiet', '-m', result.message, '--', ...changed], LOCAL_TIMEOUT);
    if (!opts.sync) return { pushed: false, message: result.message };
    try {
      git(cfg, ['push', '--quiet']);
      return { pushed: true, message: result.message };
    } catch (e) {
      const rejected = /rejected|fetch first|non-fast-forward/i.test(String(/** @type {any} */ (e).stderr ?? ''));
      if (!rejected) {
        // No network: the commit stays local and the next command pushes it.
        console.error(`warning: committed locally but could not push (${firstLine(e)})`);
        return { pushed: false, message: result.message };
      }
      // The remote changed: undo the commit (these files only; new ones are removed) and re-apply on top.
      git(cfg, ['reset', '--soft', 'HEAD~1'], LOCAL_TIMEOUT);
      git(cfg, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...changed], LOCAL_TIMEOUT);
    }
  }
  throw new Error('Could not push after 3 attempts; nothing was lost (try again).');
}

/** @param {unknown} e */
function firstLine(e) {
  const err = /** @type {any} */ (e);
  return String(err?.stderr || err?.message || e).trim().split('\n')[0];
}
