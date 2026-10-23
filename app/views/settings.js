// @ts-check
// GitHub connection: token, repo and data files of this device.
import { LS, STORES, refresh, render, state } from '../core/data.js';
import { $, lsSet } from '../core/ui.js';
import { GitHubError, readFile, writeFile } from '../../lib/github.js';
import { emptyDoc, normalize, serialize } from '../../lib/goals.js';
import { deviceTimeZone } from '../../lib/period.js';

/** @typedef {import('../../lib/github.js').RepoConfig} RepoConfig */

/** Data repo name suggested on a new device; it is the convention in the README. */
const DEFAULT_REPO = 'compass-data';

/** The owner of a GitHub Pages site (`<owner>.github.io`), or '' elsewhere (e.g. a local preview). */
function pagesOwner() {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  return m ? m[1] : '';
}

export function openSettings() {
  const dialog = /** @type {HTMLDialogElement} */ ($('settings-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('settings-form'));
  const f = /** @type {any} */ (form.elements);
  const cfg = state.cfg;
  f.token.value = cfg?.token ?? '';
  // A new device starts with the usual values: the site's owner, the data repo by convention, its root.
  f.owner.value = cfg?.owner ?? pagesOwner();
  f.repo.value = cfg?.repo ?? DEFAULT_REPO;
  f.path.value = cfg?.path ?? 'goals.json';
  f.branch.value = cfg?.branch ?? 'main';
  const msg = $('settings-msg');
  msg.textContent = '';

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    /** @type {RepoConfig} */
    const next = {
      token: String(f.token.value).trim(),
      owner: String(f.owner.value).trim(),
      repo: String(f.repo.value).trim(),
      path: String(f.path.value).trim(),
      branch: String(f.branch.value).trim() || 'main',
    };
    msg.textContent = 'Checking…';
    try {
      const { text } = await readFile(next);
      normalize(JSON.parse(text));
    } catch (err) {
      const missing = err instanceof GitHubError && err.status === 404;
      if (!missing) {
        msg.textContent = err instanceof SyntaxError ? 'The file is not valid JSON.' : /** @type {Error} */ (err).message;
        return;
      }
      const zone = deviceTimeZone();
      const ok = confirm(
        `${next.path} was not found in ${next.owner}/${next.repo} (branch ${next.branch}).\n\n` +
        `If the repo exists and the token has access, create an empty file? ` +
        `Periods will be computed in the ${zone} time zone (you can change it).`,
      );
      if (!ok) { msg.textContent = 'File not found.'; return; }
      try {
        await writeFile(next, serialize(emptyDoc(zone)), null, 'goals: create file');
      } catch (e) {
        msg.textContent = `Could not create it: ${/** @type {Error} */ (e).message}`;
        return;
      }
    }
    const changedTarget = !state.cfg || ['owner', 'repo', 'path', 'branch'].some((k) => /** @type {any} */ (state.cfg)[k] !== /** @type {any} */ (next)[k]);
    state.cfg = next;
    lsSet(LS.cfg, next);
    if (changedTarget) for (const st of STORES) st.reset();
    dialog.close();
    refresh();
  };

  $('forget-token').onclick = () => {
    if (!confirm('Forget the token on this device? Unsaved changes will be lost.')) return;
    state.cfg = null;
    for (const st of STORES) st.reset();
    lsSet(LS.cfg, null);
    dialog.close();
    render();
  };

  dialog.showModal();
}
