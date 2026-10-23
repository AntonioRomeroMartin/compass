// @ts-check
// CLI access to the data: a local git checkout of the data repo.
//
// Same model as the app: "the whole document" is never saved, only operations that are
// applied on top of the latest version. If the push fails because the remote changed, the
// local commit is undone, the remote is pulled again and the operations are re-applied on top.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * @typedef {Object} Config
 * @property {string} repo   path of the local checkout of the data repo
 * @property {string} goals  path of goals.json inside the repo
 */

const CONFIG_PATH = process.env.COMPASS_CONFIG ?? join(homedir(), '.config', 'compass', 'config.json');
const NET_TIMEOUT = 20000;

/** @returns {Config} */
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`No config at ${CONFIG_PATH}. Create it with: {"repo": "/path/to/data-repo", "goals": "goals.json"}`);
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (typeof raw.repo !== 'string' || !raw.repo) throw new Error(`"repo" missing in ${CONFIG_PATH}`);
  return { repo: resolve(raw.repo.replace(/^~(?=$|\/)/, homedir())), goals: raw.goals ?? 'goals.json' };
}

/**
 * @param {Config} cfg
 * @param {string[]} args
 * @param {number} [timeout]
 */
function git(cfg, args, timeout = NET_TIMEOUT) {
  return execFileSync('git', ['-C', cfg.repo, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Pulls the latest from the remote. Without network, it warns and continues with the local copy.
 * @param {Config} cfg
 * @returns {boolean} whether syncing succeeded
 */
export function pull(cfg) {
  try {
    git(cfg, ['pull', '--rebase', '--autostash', '--quiet']);
    return true;
  } catch (e) {
    console.error(`warning: could not pull (${firstLine(e)}); using the local copy`);
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
 * Applies `change` to the current version of the file, commits only that file and pushes.
 * `change` receives the freshly read document and returns `{ text, message }` (or null if nothing changed).
 * @param {Config} cfg
 * @param {string} rel
 * @param {(doc: any) => { text: string, message: string } | null} change
 * @param {{ sync: boolean }} opts
 * @returns {{ pushed: boolean, message: string | null }}
 */
export function commitChange(cfg, rel, change, opts) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (opts.sync && attempt > 1) pull(cfg);
    const before = readFileSync(join(cfg.repo, rel), 'utf8');
    const result = change(JSON.parse(before));
    if (!result || result.text === before) return { pushed: false, message: null };
    writeFileSync(join(cfg.repo, rel), result.text);
    git(cfg, ['add', '--', rel], 10000);
    git(cfg, ['commit', '--quiet', '-m', result.message, '--', rel], 10000);
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
      // The remote changed: undo the commit (this file only) and re-apply on top of the new version.
      git(cfg, ['reset', '--soft', 'HEAD~1'], 10000);
      git(cfg, ['restore', '--staged', '--worktree', '--', rel], 10000);
    }
  }
  throw new Error('Could not push after 3 attempts; nothing was lost (try again).');
}

/** @param {unknown} e */
function firstLine(e) {
  const err = /** @type {any} */ (e);
  return String(err?.stderr || err?.message || e).trim().split('\n')[0];
}
