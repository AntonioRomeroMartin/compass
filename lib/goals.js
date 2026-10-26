// @ts-check
// Data model of goals.json and edit operations.
//
// The app does not save "the whole document" but a list of pending operations.
// So, if the file changed on GitHub in the meantime (e.g. from another device or by hand),
// it is downloaded again and the operations are re-applied on top, overwriting nothing.

import { daysUntil, isValidTimeZone, periodKey } from './period.js';

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
 * @property {string|null} deadline   YYYY-MM-DD, only for horizon "deadline"
 * @property {string|null} [period]   period key the goal belongs to (e.g. "2026-W40"); it expires when
 *                                    that period ends. null for horizon "deadline"
 * @property {Record<string, number>} progress  periodKey -> number
 * @property {string} createdAt       ISO 8601
 * @property {string|null} [repo]
 * @property {string|null} [location]  where (optional, free text)
 * @property {string|null} [notes]     free notes (optional, multi-line)
 * @property {Subgoal[]} [subgoals]  optional steps to achieve it
 * @property {boolean} [archived]
 */

/**
 * Sub-goal (step). `done` lists the period key in which it was completed (the goal's own period).
 * @typedef {Object} Subgoal
 * @property {string} id
 * @property {string} title
 * @property {string[]} done
 */

/**
 * @typedef {Object} GoalsDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone in which the periods are computed
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
 * Empty document (no categories: each person creates their own).
 * @param {string} [timeZone]
 * @returns {GoalsDoc}
 */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), categories: [], goals: [] };
}

/**
 * Goals (archived ones included) that use a category.
 * @param {GoalsDoc} doc
 * @param {string} name
 */
export function categoryUsage(doc, name) {
  return doc.goals.filter((g) => g.category === name).length;
}

/**
 * Normalizes a document that was read (tolerates missing fields).
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
    // Goals no longer repeat (habits will be a module of their own): an old repeating goal, or one without
    // a period, belongs to the period in which it was created.
    delete g.repeat;
    if (g.horizon === 'deadline') g.period = null;
    else if (!g.period) g.period = periodKey(g.horizon, g.createdAt || new Date(), isValidTimeZone(doc.timeZone) ? doc.timeZone : 'UTC');
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
 * Period key in which the goal's progress is recorded: its own period, or "once" with a deadline.
 * @param {Goal} g @param {Date} now @param {string} tz
 */
export function goalKey(g, now, tz) {
  if (g.horizon === 'deadline') return 'once';
  return g.period ?? periodKey(g.horizon, now, tz);
}

/**
 * Has it expired? (Its period or its deadline is over.)
 * @param {Goal} g @param {Date} now @param {string} tz
 */
export function isExpired(g, now, tz) {
  if (g.horizon === 'deadline') return !!g.deadline && daysUntil(g.deadline, now, tz) < 0;
  return !!g.period && g.period !== periodKey(g.horizon, now, tz);
}

/**
 * Met in that period? With a target: reaching it. Without one: marked as done.
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
 * Applies operations to a copy of the document. Operations on goals
 * that no longer exist are ignored (e.g. if it was deleted elsewhere).
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
        // Only if no goal uses it (if the file changed in the meantime, that is respected).
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
 * Document text as it is saved (2 spaces + trailing newline, clean diffs). Used by every data file.
 * @param {object} doc
 */
export function serialize(doc) {
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * Commit message for a batch of operations.
 * @param {Op[]} ops
 * @param {GoalsDoc} before  base document (titles of what was deleted)
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

/**
 * What goals bring to a day view: live goals of the day and the week, and deadlines within 7 days
 * (late ones are already in Past).
 * @param {GoalsDoc} doc @param {Date} now @param {string} tz
 * @returns {{ live: number, today: Goal[] }}
 */
export function summary(doc, now, tz) {
  const live = doc.goals.filter((g) => !g.archived && !isExpired(g, now, tz));
  const today = live.filter((g) =>
    g.horizon === 'day' || g.horizon === 'week' ||
    (g.horizon === 'deadline' && !!g.deadline && daysUntil(g.deadline, now, tz) <= 7));
  return { live: live.length, today };
}
