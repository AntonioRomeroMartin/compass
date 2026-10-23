// @ts-check
// Acceso de la CLI a los datos: un checkout local de git del repo de datos.
//
// Mismo modelo que la app: nunca se guarda "el documento entero", sino operaciones que se
// aplican sobre la última versión. Si el push falla porque el remoto cambió, se deshace el
// commit local, se vuelve a bajar y se reaplican las operaciones encima.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * @typedef {Object} Config
 * @property {string} repo   ruta del checkout local del repo de datos
 * @property {string} goals  ruta de goals.json dentro del repo
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
 * Trae lo último del remoto. Sin red, avisa y sigue con la copia local.
 * @param {Config} cfg
 * @returns {boolean} si se pudo sincronizar
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
 * Aplica `change` sobre la versión actual del archivo, hace commit solo de ese archivo y push.
 * `change` recibe el documento recién leído y devuelve `{ text, message }` (o null si no hay cambio).
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
        // Sin red: el commit queda en local y lo sube el siguiente comando o autosave.
        console.error(`warning: committed locally but could not push (${firstLine(e)})`);
        return { pushed: false, message: result.message };
      }
      // El remoto cambió: deshacer el commit (solo este archivo) y reaplicar sobre lo nuevo.
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
