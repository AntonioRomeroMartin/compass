// @ts-check
// One JSON file of the data repo, kept in sync with GitHub: the last confirmed version (base) plus the
// operations not saved yet (pending), both cached in localStorage. Writes are grouped every ~2 s; if
// someone else changed the file, the pending operations are applied again on top of the new version.

import { GitHubError, readFile, writeFile } from '../../lib/github.js';

/** @typedef {import('../../lib/github.js').RepoConfig} RepoConfig */

/**
 * The pure functions of a data module (lib/goals.js, lib/tasks.js, lib/domains.js).
 * @template D, O
 * @typedef {Object} Module
 * @property {(raw: unknown) => D} normalize
 * @property {(doc: D, ops: O[]) => D} applyOps
 * @property {(doc: D) => string} serialize
 * @property {(ops: O[], before: D, after: D) => string} commitMessage
 */

const SAVE_DELAY_MS = 2000;

/** @param {string} key */
function lsGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
/** @param {string} key @param {unknown} value */
function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the app keeps working in memory
  }
}

/** fetch() fails with TypeError when there is no network. @param {unknown} err */
export const isNetworkError = (err) => err instanceof TypeError;

/**
 * @template D, O
 * @param {Object} opts
 * @param {Module<D, O>} opts.mod
 * @param {string} opts.file             file name next to the goals file, e.g. "tasks.json"; null = the goals file itself
 * @param {string} opts.ls               localStorage prefix ("goals" keeps the keys of earlier versions)
 * @param {() => D} opts.empty           document to use when the file does not exist yet (created on the first save)
 * @param {() => RepoConfig|null} opts.cfg
 * @param {() => void} opts.onChange
 */
export function createStore({ mod, file, ls, empty, cfg, onChange }) {
  const keys = { cache: `${ls}.cache`, pending: `${ls}.pending` };
  const s = {
    /** @type {D} */ base: empty(),
    /** @type {string|null} null = the file does not exist on GitHub yet */ sha: null,
    /** @type {O[]} */ pending: [],
    /** @type {string|null} */ fetchedAt: null,
    loaded: false,
    saving: false,
    online: navigator.onLine,
    /** @type {string|null} */ error: null,
  };
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;

  /** Config pointing at this store's file (same folder as the goals file). */
  const target = () => {
    const c = cfg();
    if (!c) return null;
    if (!file) return c;
    const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/') + 1) : '';
    return { ...c, path: dir + file };
  };

  const save = () => {
    lsSet(keys.cache, { doc: s.base, sha: s.sha, fetchedAt: s.fetchedAt });
    lsSet(keys.pending, s.pending.length ? s.pending : null);
  };

  /** Reads the file; a missing one counts as empty. */
  async function read() {
    const t = /** @type {RepoConfig} */ (target());
    try {
      const { text, sha } = await readFile(t);
      return { doc: mod.normalize(JSON.parse(text)), sha };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return { doc: empty(), sha: null };
      throw err;
    }
  }

  async function refresh() {
    // While saving, the save itself brings the new version (and a read started now could land after it, older).
    if (!target() || s.saving) return;
    try {
      const { doc, sha } = await read();
      s.base = doc;
      s.sha = sha;
      s.fetchedAt = new Date().toISOString();
      s.loaded = true;
      s.online = true;
      s.error = null;
      save();
      if (s.pending.length) schedule(0);
    } catch (err) {
      if (isNetworkError(err)) s.online = false;
      else s.error = err instanceof SyntaxError ? `${target()?.path} is not valid JSON.` : /** @type {Error} */ (err).message;
    }
    onChange();
  }

  /** @param {number} [delay] */
  function schedule(delay = SAVE_DELAY_MS) {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  async function flush() {
    const t = target();
    if (s.saving || !s.pending.length || !t || !s.loaded) return;
    s.saving = true;
    onChange();
    const batch = s.pending.slice();
    try {
      for (let attempt = 0; ; attempt++) {
        const next = mod.applyOps(s.base, batch);
        try {
          s.sha = await writeFile(t, mod.serialize(next), s.sha, mod.commitMessage(batch, s.base, next));
          s.base = next;
          s.pending = s.pending.slice(batch.length);
          s.fetchedAt = new Date().toISOString();
          s.error = null;
          save();
          break;
        } catch (err) {
          const conflict = err instanceof GitHubError && (err.status === 409 || err.status === 422);
          if (!conflict || attempt >= 3) throw err;
          // Someone else (another device, the CLI) changed the file: re-read and re-apply on top.
          ({ doc: s.base, sha: s.sha } = await read());
        }
      }
    } catch (err) {
      if (isNetworkError(err)) s.online = false;
      else s.error = `Could not save: ${/** @type {Error} */ (err).message}`;
    } finally {
      s.saving = false;
      onChange();
    }
    if (s.pending.length && s.online && !s.error) schedule();
  }

  /** @param {O[]} ops */
  function dispatch(ops) {
    if (!ops.length) return;
    s.pending.push(...ops);
    save();
    onChange();
    schedule();
  }

  /** Forgets everything of this file on this device (another repo or file was chosen). */
  function reset() {
    clearTimeout(timer);
    s.base = empty();
    s.sha = null;
    s.pending = [];
    s.fetchedAt = null;
    s.loaded = false;
    s.error = null;
    lsSet(keys.cache, null);
    lsSet(keys.pending, null);
  }

  // Start from the copy saved on this device.
  const cache = lsGet(keys.cache);
  if (cache?.doc) {
    s.base = mod.normalize(cache.doc);
    s.sha = cache.sha ?? null;
    s.fetchedAt = cache.fetchedAt ?? null;
  }
  s.pending = lsGet(keys.pending) ?? [];

  return {
    state: s,
    current: () => mod.applyOps(s.base, s.pending),
    refresh,
    flush,
    dispatch,
    reset,
  };
}
