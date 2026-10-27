// @ts-check
// Data model of habits.json and edit operations (same shape as the other data files: normalize,
// applyOps re-applied on the latest version, serialize, commitMessage).
//
// A habit is something done on some days, marked done or not done per day: every day, N times a week (any days)
// or on given weekdays. Weeks run Monday to Sunday. There are no streaks: each habit shows how this week is going.

import { addDays, isDate, isoWeekday } from './period.js';
import { weekday } from './tasks.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * How often: every day, `times` days a week (any of them), or on given ISO weekdays (1 = Monday).
 * @typedef {{ type: 'daily' } | { type: 'weekly', times: number } | { type: 'days', days: number[] }} Freq
 */

/**
 * @typedef {Object} Habit
 * @property {string} id
 * @property {string} title
 * @property {string} domain          domain id (see lib/domains.js); required
 * @property {Freq} freq
 * @property {string|null} notes
 * @property {string[]} done          days it was done (YYYY-MM-DD, sorted)
 * @property {boolean} [archived]     retired: hidden, its history kept
 * @property {string} createdAt       ISO 8601
 */

/**
 * @typedef {Object} HabitsDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of the civil dates
 * @property {Habit[]} habits
 */

/**
 * @typedef {{ type: 'add', habit: Habit }
 *   | { type: 'edit', id: string, fields: Partial<Pick<Habit, 'title'|'domain'|'freq'|'notes'>> }
 *   | { type: 'mark', id: string, date: string, done: boolean }
 *   | { type: 'archive', id: string, archived: boolean }
 *   | { type: 'delete', id: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** @param {string} [timeZone] @returns {HabitsDoc} */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), habits: [] };
}

/**
 * A valid frequency (copied and tidied), or null.
 * @param {any} f
 * @returns {Freq | null}
 */
export function validFreq(f) {
  if (!f || typeof f !== 'object') return null;
  if (f.type === 'daily') return { type: 'daily' };
  if (f.type === 'weekly' && Number.isInteger(f.times) && f.times >= 1 && f.times <= 7) return { type: 'weekly', times: f.times };
  if (f.type === 'days' && Array.isArray(f.days)) {
    const days = [...new Set(f.days.filter((/** @type {unknown} */ d) => Number.isInteger(d) && /** @type {number} */ (d) >= 1 && /** @type {number} */ (d) <= 7))].sort();
    return days.length ? { type: 'days', days: /** @type {number[]} */ (days) } : null;
  }
  return null;
}

/**
 * Parses a frequency as typed: "daily", "3/week" (also "3x", "3 per week"), "mon,thu".
 * @param {string} text
 * @returns {Freq}
 */
export function parseFreq(text) {
  const s = text.trim().toLowerCase();
  if (s === 'daily' || s === 'every day') return { type: 'daily' };
  const m = /^(\d)\s*(?:x|times)?\s*(?:\/|a|per)?\s*(?:w|wk|week)?$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 7) return Number(m[1]) === 7 ? { type: 'daily' } : { type: 'weekly', times: Number(m[1]) };
  const days = s.split(/\s*,\s*|\s+/).map(weekday);
  if (days.length && days.every((d) => d > 0)) return /** @type {Freq} */ (validFreq({ type: 'days', days }));
  throw new Error(`unknown frequency “${text}” (daily, 3/week, mon,thu)`);
}

/** Short text: "daily", "3/week", "mon,thu". @param {Freq} f */
export function freqText(f) {
  if (f.type === 'daily') return 'daily';
  if (f.type === 'weekly') return `${f.times}/week`;
  return f.days.map((d) => WEEKDAYS[d - 1]).join(',');
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Normalizes a document that was read (tolerates missing fields; drops habits without id, title or frequency).
 * @param {any} raw
 * @returns {HabitsDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const habits = (Array.isArray(doc.habits) ? doc.habits : [])
    .filter((/** @type {any} */ x) => x && typeof x.id === 'string' && typeof x.title === 'string' && validFreq(x.freq))
    .map((/** @type {any} */ x) => {
      /** @type {Habit} */
      const habit = {
        ...x,
        domain: typeof x.domain === 'string' ? x.domain : '',
        freq: /** @type {Freq} */ (validFreq(x.freq)),
        notes: textOrNull(x.notes),
        done: [...new Set((Array.isArray(x.done) ? x.done : []).filter(isDate))].sort(),
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : '',
      };
      if (x.archived === true) habit.archived = true;
      else delete habit.archived;
      return habit;
    });
  return { ...doc, version: Number(doc.version) || 1, habits };
}

/**
 * New habit with every field filled in.
 * @param {Pick<Habit, 'title'|'domain'|'freq'> & Partial<Habit>} fields
 * @param {Date} [now]
 * @returns {Habit}
 */
export function newHabit(fields, now = new Date()) {
  return { id: newId('h_'), notes: null, done: [], createdAt: now.toISOString(), ...fields };
}

/** Done on that day? @param {Habit} h @param {string} date */
export const isDoneOn = (h, date) => h.done.includes(date);

/** The seven days (Monday to Sunday) of the week of a date. @param {string} date */
export function weekOf(date) {
  const monday = addDays(date, 1 - isoWeekday(date));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Is that a day it is meant for? (Every day is, except for habits on given weekdays.) @param {Habit} h @param {string} date */
export const isPlanned = (h, date) => h.freq.type !== 'days' || h.freq.days.includes(isoWeekday(date));

/**
 * How the week of `date` is going: days done (on the planned days) and how many it asks for.
 * Daily: of 7; N a week: of N (it may go over); given weekdays: of those days.
 * @param {Habit} h @param {string} date
 * @returns {{ done: number, of: number }}
 */
export function weekProgress(h, date) {
  const done = weekOf(date).filter((d) => isPlanned(h, d) && isDoneOn(h, d)).length;
  const of = h.freq.type === 'daily' ? 7 : h.freq.type === 'weekly' ? h.freq.times : h.freq.days.length;
  return { done, of };
}

/**
 * Does it belong in that day's list? Daily: always. Given weekdays: on those days. N a week: until the week
 * has N (the day it is done it stays, ticked).
 * @param {Habit} h @param {string} date
 */
export function isDueOn(h, date) {
  if (h.archived) return false;
  if (h.freq.type !== 'weekly') return isPlanned(h, date);
  if (isDoneOn(h, date)) return true;
  return weekProgress(h, date).done < h.freq.times;
}

/**
 * Applies operations to a copy of the document. Operations on habits that no longer exist are ignored.
 * @param {HabitsDoc} doc
 * @param {Op[]} ops
 * @returns {HabitsDoc}
 */
export function applyOps(doc, ops) {
  /** @type {HabitsDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.habits.find((x) => x.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.habit.id)) out.habits.push(structuredClone(op.habit));
        break;
      case 'edit': {
        const h = find(op.id);
        if (h) Object.assign(h, structuredClone(op.fields));
        break;
      }
      case 'mark': {
        const h = find(op.id);
        if (!h || !isDate(op.date)) break;
        h.done = h.done.filter((d) => d !== op.date);
        if (op.done) h.done = [...h.done, op.date].sort();
        break;
      }
      case 'archive': {
        const h = find(op.id);
        if (!h) break;
        if (op.archived) h.archived = true;
        else delete h.archived;
        break;
      }
      case 'delete':
        out.habits = out.habits.filter((x) => x.id !== op.id);
        break;
      case 'setTimeZone':
        out.timeZone = op.timeZone;
        break;
    }
  }
  return out;
}

/**
 * Commit message for a batch of operations.
 * @param {Op[]} ops
 * @param {HabitsDoc} before  base document (titles of what was deleted)
 * @param {HabitsDoc} after
 */
export function commitMessage(ops, before, after) {
  /** @param {string} id */
  const title = (id) => after.habits.find((x) => x.id === id)?.title ?? before.habits.find((x) => x.id === id)?.title ?? id;
  const parts = new Set();
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new “${op.habit.title}”`); break;
      case 'edit': parts.add(`edited “${title(op.id)}”`); break;
      case 'mark': parts.add(`${op.done ? 'done' : 'undone'} “${title(op.id)}” ${op.date}`); break;
      case 'archive': parts.add(`${op.archived ? 'archived' : 'restored'} “${title(op.id)}”`); break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  const text = [...parts].join(', ');
  return `habits: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}
