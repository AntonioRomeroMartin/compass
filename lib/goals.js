// @ts-check
// Modelo de datos de goals.json y operaciones de edición.
//
// La app no guarda "el documento entero" sino una lista de operaciones pendientes.
// Así, si el archivo cambió en GitHub mientras tanto (por ejemplo, desde otro dispositivo o a mano),
// se vuelve a descargar y se reaplican las operaciones encima, sin pisar nada.

import { daysUntil, periodKey } from './period.js';

/** @typedef {import('./period.js').Horizon} Horizon */

/**
 * @typedef {Object} Goal
 * @property {string} id
 * @property {'goal'} kind
 * @property {string} title
 * @property {string} category
 * @property {Horizon} horizon
 * @property {number|null} target
 * @property {string|null} unit
 * @property {string|null} deadline   YYYY-MM-DD, solo para horizon "deadline"
 * @property {boolean} [repeat]       true: se renueva en cada periodo (hábito);
 *                                    false: de una vez, caduca al terminar `period`
 * @property {string|null} [period]   clave del periodo de un objetivo de una vez (p. ej. "2026-W40")
 * @property {Record<string, number>} progress  claveDePeriodo -> número
 * @property {string} createdAt       ISO 8601
 * @property {string|null} [repo]
 * @property {string|null} [location]  dónde (opcional, texto libre)
 * @property {string|null} [notes]     notas libres (opcional, varias líneas)
 * @property {Subgoal[]} [subgoals]  pasos opcionales para lograrlo
 * @property {boolean} [archived]
 */

/**
 * Sub-objetivo (paso). `done` lista las claves de periodo en que se completó: en un hábito
 * se desmarca solo al empezar el periodo siguiente; en uno de una vez la clave es fija.
 * @typedef {Object} Subgoal
 * @property {string} id
 * @property {string} title
 * @property {string[]} done
 */

/**
 * @typedef {Object} GoalsDoc
 * @property {number} version
 * @property {string} [timeZone]  zona IANA en la que se calculan los periodos
 * @property {string[]} categories
 * @property {Goal[]} goals
 */

/**
 * @typedef {{ type: 'add', goal: Goal }
 *   | { type: 'edit', id: string, fields: Partial<Omit<Goal, 'id'|'kind'|'progress'|'createdAt'|'subgoals'>> }
 *   | { type: 'inc', id: string, key: string, delta: number }
 *   | { type: 'set', id: string, key: string, value: number }
 *   | { type: 'archive', id: string, archived: boolean }
 *   | { type: 'delete', id: string }
 *   | { type: 'addSub', id: string, sub: Subgoal }
 *   | { type: 'editSub', id: string, subId: string, title: string }
 *   | { type: 'toggleSub', id: string, subId: string, key: string, done: boolean }
 *   | { type: 'removeSub', id: string, subId: string }
 *   | { type: 'addCategory', name: string }
 *   | { type: 'removeCategory', name: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/**
 * Documento vacío (sin categorías: cada persona crea las suyas).
 * @param {string} [timeZone]
 * @returns {GoalsDoc}
 */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), categories: [], goals: [] };
}

/**
 * Objetivos (incluidos los archivados) que usan una categoría.
 * @param {GoalsDoc} doc
 * @param {string} name
 */
export function categoryUsage(doc, name) {
  return doc.goals.filter((g) => g.category === name).length;
}

/**
 * Normaliza un documento leído (tolera campos ausentes).
 * @param {any} raw
 * @returns {GoalsDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' ? raw : {};
  const goals = Array.isArray(doc.goals) ? doc.goals : [];
  const categories = Array.isArray(doc.categories) ? doc.categories.filter((/** @type {unknown} */ c) => typeof c === 'string') : [];
  for (const g of goals) {
    if (g.category && !categories.includes(g.category)) categories.push(g.category);
    if (!g.progress || typeof g.progress !== 'object') g.progress = {};
    // Compatibilidad: un objetivo con plazo sin `repeat` ni `period` se trata como hábito.
    if (typeof g.repeat !== 'boolean') g.repeat = g.horizon !== 'deadline' && !g.period;
    if (g.horizon === 'deadline') g.repeat = false;
    if (g.subgoals !== undefined) {
      g.subgoals = (Array.isArray(g.subgoals) ? g.subgoals : [])
        .filter((/** @type {any} */ s) => s && typeof s.id === 'string' && typeof s.title === 'string')
        .map((/** @type {any} */ s) => ({ ...s, done: Array.isArray(s.done) ? s.done.filter((/** @type {unknown} */ k) => typeof k === 'string') : [] }));
      if (!g.subgoals.length) delete g.subgoals;
    }
  }
  return { ...doc, version: Number(doc.version) || 1, categories, goals };
}

/**
 * Clave de periodo en la que se anota el progreso del objetivo "ahora".
 * Hábitos: el periodo actual. De una vez: su propio periodo. Fecha límite: "once".
 * @param {Goal} g @param {Date} now @param {string} tz
 */
export function goalKey(g, now, tz) {
  if (g.horizon === 'deadline') return 'once';
  if (g.repeat || !g.period) return periodKey(g.horizon, now, tz);
  return g.period;
}

/**
 * ¿Ha caducado? (Los hábitos nunca caducan.)
 * @param {Goal} g @param {Date} now @param {string} tz
 */
export function isExpired(g, now, tz) {
  if (g.horizon === 'deadline') return !!g.deadline && daysUntil(g.deadline, now, tz) < 0;
  if (g.repeat || !g.period) return false;
  return g.period !== periodKey(g.horizon, now, tz);
}

/**
 * ¿Cumplido en ese periodo? Con meta: llegar a ella. Sin meta: marcado como hecho.
 * @param {Goal} g @param {string} key
 */
export function isDone(g, key) {
  const value = g.progress[key] ?? 0;
  return g.target && g.target > 0 ? value >= g.target : value > 0;
}

/**
 * Sub-objetivos completados en ese periodo.
 * @param {Goal} g @param {string} key
 */
export function subgoalsDone(g, key) {
  return (g.subgoals ?? []).filter((s) => s.done.includes(key)).length;
}

/** @param {string} [prefix] */
export function newId(prefix = 'g_') {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

/**
 * Aplica operaciones sobre una copia del documento. Las operaciones sobre objetivos
 * que ya no existen se ignoran (por ejemplo, si se borró en otro sitio).
 * @param {GoalsDoc} doc
 * @param {Op[]} ops
 * @returns {GoalsDoc}
 */
export function applyOps(doc, ops) {
  /** @type {GoalsDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.goals.find((g) => g.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.goal.id)) out.goals.push(structuredClone(op.goal));
        if (!out.categories.includes(op.goal.category)) out.categories.push(op.goal.category);
        break;
      case 'edit': {
        const g = find(op.id);
        if (!g) break;
        Object.assign(g, structuredClone(op.fields));
        if (g.category && !out.categories.includes(g.category)) out.categories.push(g.category);
        break;
      }
      case 'inc': {
        const g = find(op.id);
        if (!g) break;
        const next = (g.progress[op.key] ?? 0) + op.delta;
        if (next > 0) g.progress[op.key] = round(next);
        else delete g.progress[op.key];
        break;
      }
      case 'set': {
        const g = find(op.id);
        if (!g) break;
        if (op.value > 0) g.progress[op.key] = round(op.value);
        else delete g.progress[op.key];
        break;
      }
      case 'archive': {
        const g = find(op.id);
        if (!g) break;
        if (op.archived) g.archived = true;
        else delete g.archived;
        break;
      }
      case 'delete':
        out.goals = out.goals.filter((g) => g.id !== op.id);
        break;
      case 'addSub': {
        const g = find(op.id);
        if (!g || g.subgoals?.some((s) => s.id === op.sub.id)) break;
        (g.subgoals ??= []).push(structuredClone(op.sub));
        break;
      }
      case 'editSub': {
        const s = find(op.id)?.subgoals?.find((x) => x.id === op.subId);
        if (s) s.title = op.title;
        break;
      }
      case 'toggleSub': {
        const s = find(op.id)?.subgoals?.find((x) => x.id === op.subId);
        if (!s) break;
        s.done = s.done.filter((k) => k !== op.key);
        if (op.done) s.done.push(op.key);
        break;
      }
      case 'removeSub': {
        const g = find(op.id);
        if (!g?.subgoals) break;
        g.subgoals = g.subgoals.filter((s) => s.id !== op.subId);
        if (!g.subgoals.length) delete g.subgoals;
        break;
      }
      case 'addCategory':
        if (op.name && !out.categories.includes(op.name)) out.categories.push(op.name);
        break;
      case 'removeCategory':
        // Solo si ningún objetivo la usa (si el archivo cambió mientras tanto, se respeta).
        if (!categoryUsage(out, op.name)) out.categories = out.categories.filter((c) => c !== op.name);
        break;
      case 'setTimeZone':
        out.timeZone = op.timeZone;
        break;
    }
  }
  return out;
}

/** @param {number} n */
const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Texto del documento tal y como se guarda (2 espacios + salto final, diffs limpios).
 * @param {GoalsDoc} doc
 */
export function serialize(doc) {
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * Mensaje de commit para un lote de operaciones.
 * @param {Op[]} ops
 * @param {GoalsDoc} before  documento base (títulos de lo borrado)
 * @param {GoalsDoc} after   documento resultante
 */
export function commitMessage(ops, before, after) {
  /** @param {string} id */
  const title = (id) =>
    after.goals.find((g) => g.id === id)?.title ?? before.goals.find((g) => g.id === id)?.title ?? id;
  const parts = new Set();
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new “${op.goal.title}”`); break;
      case 'edit': parts.add(`edited “${title(op.id)}”`); break;
      case 'inc':
      case 'set': parts.add(`progress “${title(op.id)}”`); break;
      case 'archive': parts.add(`${op.archived ? 'archived' : 'restored'} “${title(op.id)}”`); break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'addSub':
      case 'editSub':
      case 'toggleSub':
      case 'removeSub': parts.add(`sub-goals “${title(op.id)}”`); break;
      case 'addCategory': parts.add(`category “${op.name}”`); break;
      case 'removeCategory': parts.add(`removed category “${op.name}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  const text = [...parts].join(', ');
  return `goals: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}
