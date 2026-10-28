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
 * @param {boolean} [opts.required]      the file must exist: if it is missing, the settings are wrong (no empty document)
 * @param {() => boolean} [opts.ready]   saving is allowed (e.g. only once the required file was found)
 * @param {() => RepoConfig|null} opts.cfg
 * @param {() => void} opts.onChange
 * @param {{ decode: (text: string) => Promise<string>, encode: (text: string) => Promise<string> }} [opts.codec]
 *   for a sealed file: opens what is read and seals what is written (the local copy is kept open)
 * @param {() => boolean} [opts.active]  the file is used on this device (e.g. its passphrase is set); if not, nothing is read or written
 */
export function createStore({ mod, file, ls, empty, cfg, onChange, required = false, ready = () => true, codec, active = () => true }) {
  const keys = { cache: `${ls}.cache`, pending: `${ls}.pending` };
  const s = {
    /** @type {D} */ base: empty(),
    /** @type {string|null} null = the file does not exist on GitHub yet */ sha: null,
    /** @type {string|null} of the last read: the next one downloads nothing if the file did not change */ etag: null,
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
    lsSet(keys.cache, { doc: s.base, sha: s.sha, etag: s.etag, fetchedAt: s.fetchedAt });
    lsSet(keys.pending, s.pending.length ? s.pending : null);
  };

  /**
   * Reads the file; a missing one counts as empty (unless it is required). With `known`, the version in hand
   * is sent as an ETag and null comes back if it is still the current one.
   * @param {boolean} [known]
   * @returns {Promise<{ doc: D, sha: string|null, etag: string|null } | null>}
   */
  async function read(known = false) {
    const t = /** @type {RepoConfig} */ (target());
    try {
      const res = await readFile(t, known ? s.etag : null);
      if (res.unchanged) return null;
      const text = codec ? await codec.decode(res.text) : res.text;
      return { doc: mod.normalize(JSON.parse(text)), sha: res.sha, etag: res.etag };
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        if (required) throw new Error(`${t.path} was not found in ${t.owner}/${t.repo}. Check the repo and file in More → GitHub connection.`);
        return { doc: empty(), sha: null, etag: null };
      }
      throw err;
    }
  }

  async function refresh() {
    // While saving, the save itself brings the new version (and a read started now could land after it, older).
    if (!target() || s.saving || !active()) return;
    try {
      const fresh = await read(s.loaded || !!s.fetchedAt);
      if (fresh) ({ doc: s.base, sha: s.sha, etag: s.etag } = fresh);
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
    if (s.saving || !s.pending.length || !t || !s.loaded || !ready() || !active()) return;
    s.saving = true;
    onChange();
    const batch = s.pending.slice();
    try {
      for (let attempt = 0; ; attempt++) {
        const next = mod.applyOps(s.base, batch);
        try {
          const text = mod.serialize(next);
          s.sha = await writeFile(t, codec ? await codec.encode(text) : text, s.sha, mod.commitMessage(batch, s.base, next));
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
          ({ doc: s.base, sha: s.sha, etag: s.etag } = /** @type {{ doc: D, sha: string|null, etag: string|null }} */ (await read()));
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
    s.etag = null;
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
    s.etag = cache.etag ?? null;
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
