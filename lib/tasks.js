// @ts-check
// Data model of tasks.json and edit operations. Same model as goals.js: what is saved is a list of
// operations, re-applied on top of the latest version of the file, so nothing done elsewhere is overwritten.
//
// Dates are civil days (`YYYY-MM-DD`) in the file's `timeZone`; the caller computes "today" with
// lib/period.js and puts it in the operation, so applying operations never depends on the clock.

import { addDays, civilDate, daysInMonth, endOfWeek, formatDate, isDate, isoWeekday } from './period.js';
import { newId } from './goals.js';

export { serialize } from './goals.js';

/** Open tasks with focus at the same time. */
export const FOCUS_MAX = 3;

/** @typedef {'open'|'done'|'dropped'} Status */

/**
 * Repetition rule. Weekdays are ISO: 1 = Monday … 7 = Sunday. A monthly day past the end
 * of a short month falls on its last day (31 → 30 Apr, 28/29 Feb).
 * @typedef {{ type: 'days', every: number }
 *   | { type: 'weekly', days: number[] }
 *   | { type: 'monthly', day: number }} Repeat
 */

/**
 * @typedef {Object} Subtask
 * @property {string} id
 * @property {string} title
 * @property {boolean} done
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} domain          domain id (see lib/domains.js); required
 * @property {string|null} due        YYYY-MM-DD
 * @property {string|null} notes
 * @property {Subtask[]} subtasks
 * @property {Repeat|null} repeat     when completed (or dropped), the next occurrence is created
 * @property {boolean} focus          at most FOCUS_MAX open tasks at a time
 * @property {string|null} goal       id of a goal that gets +1 when the task is completed
 * @property {string|null} ongoing    path (inside the data repo or the domain's folder) of a text file
 *                                    with the state of the work in progress
 * @property {string|null} location   where it is done ("library", "gym")
 * @property {Status} status
 * @property {string} createdAt       ISO 8601
 * @property {string|null} doneAt     when it was closed (done or dropped)
 * @property {string} [next]          id of the occurrence created when this one was closed
 */

/**
 * @typedef {Object} TasksDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of the civil dates
 * @property {Task[]} tasks
 */

/**
 * `today` is the civil date when the operation was made (in the file's zone): the next
 * occurrence of a repeating task is computed from it. `nextId` = id for that occurrence
 * (null: do not create one, e.g. to stop a series).
 * @typedef {{ type: 'add', task: Task }
 *   | { type: 'edit', id: string, fields: Partial<Pick<Task, 'title'|'domain'|'due'|'notes'|'repeat'|'goal'|'ongoing'|'location'>> }
 *   | { type: 'done', id: string, at: string, today: string, nextId: string | null }
 *   | { type: 'drop', id: string, at: string, today: string, nextId: string | null }
 *   | { type: 'reopen', id: string }
 *   | { type: 'focus', id: string, focus: boolean }
 *   | { type: 'addSub', id: string, sub: Subtask }
 *   | { type: 'editSub', id: string, subId: string, title: string }
 *   | { type: 'toggleSub', id: string, subId: string, done: boolean }
 *   | { type: 'removeSub', id: string, subId: string }
 *   | { type: 'delete', id: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

const STATUSES = ['open', 'done', 'dropped'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * ISO weekday of a name or its abbreviation ("thu", "thursday"); 0 if it is not one.
 * @param {string} word
 */
function weekday(word) {
  return word.length >= 3 ? WEEKDAY_NAMES.findIndex((n) => n.startsWith(word)) + 1 : 0;
}

/**
 * @param {string} [timeZone]
 * @returns {TasksDoc}
 */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), tasks: [] };
}

/**
 * A valid rule (copied and tidied), or null.
 * @param {any} r
 * @returns {Repeat | null}
 */
export function validRepeat(r) {
  if (!r || typeof r !== 'object') return null;
  /** @param {unknown} n @param {number} min @param {number} max */
  const int = (n, min, max) => Number.isInteger(n) && /** @type {number} */ (n) >= min && /** @type {number} */ (n) <= max;
  if (r.type === 'days' && int(r.every, 1, 3660)) return { type: 'days', every: r.every };
  if (r.type === 'weekly' && Array.isArray(r.days)) {
    const days = [...new Set(r.days.filter((/** @type {unknown} */ d) => int(d, 1, 7)))].sort();
    return days.length ? { type: 'weekly', days: /** @type {number[]} */ (days) } : null;
  }
  if (r.type === 'monthly' && int(r.day, 1, 31)) return { type: 'monthly', day: r.day };
  return null;
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Normalizes a document that was read (tolerates missing fields; drops tasks without id or title).
 * @param {any} raw
 * @returns {TasksDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const tasks = (Array.isArray(doc.tasks) ? doc.tasks : [])
    .filter((/** @type {any} */ t) => t && typeof t.id === 'string' && typeof t.title === 'string')
    .map((/** @type {any} */ t) => {
      /** @type {Task} */
      const task = {
        ...t,
        domain: typeof t.domain === 'string' ? t.domain : '',
        due: isDate(t.due) ? t.due : null,
        notes: textOrNull(t.notes),
        subtasks: (Array.isArray(t.subtasks) ? t.subtasks : [])
          .filter((/** @type {any} */ s) => s && typeof s.id === 'string' && typeof s.title === 'string')
          .map((/** @type {any} */ s) => ({ id: s.id, title: s.title, done: s.done === true })),
        repeat: validRepeat(t.repeat),
        focus: t.focus === true,
        goal: textOrNull(t.goal),
        ongoing: textOrNull(t.ongoing),
        location: textOrNull(t.location),
        status: STATUSES.includes(t.status) ? t.status : 'open',
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
        doneAt: textOrNull(t.doneAt),
      };
      if (typeof task.next !== 'string') delete task.next;
      return task;
    });
  return { ...doc, version: Number(doc.version) || 1, tasks };
}

/**
 * New open task with every field filled in.
 * @param {Pick<Task, 'title'|'domain'> & Partial<Task>} fields
 * @param {Date} [now]
 * @returns {Task}
 */
export function newTask(fields, now = new Date()) {
  return {
    id: newId('t_'), due: null, notes: null, subtasks: [], repeat: null, focus: false, goal: null, ongoing: null,
    location: null, status: 'open', createdAt: now.toISOString(), doneAt: null, ...fields,
  };
}

/**
 * Open tasks with focus.
 * @param {TasksDoc} doc
 */
export function focused(doc) {
  return doc.tasks.filter((t) => t.status === 'open' && t.focus);
}

/**
 * Can this task get focus without going over FOCUS_MAX?
 * @param {TasksDoc} doc
 * @param {string} id
 */
export function canFocus(doc, id) {
  return focused(doc).filter((t) => t.id !== id).length < FOCUS_MAX;
}

/**
 * First day of a rule on or after `from` (for a new repeating task without a date).
 * @param {Repeat} rule
 * @param {string} from  YYYY-MM-DD
 */
export function firstDue(rule, from) {
  return rule.type === 'days' ? from : nextMatch(rule, addDays(from, -1));
}

/**
 * Due date of the next occurrence. It counts from the due date, or from `today` if the task
 * is late (or had no date), so a late completion does not leave a pile of overdue copies:
 * every 3 days, due Fri, done Wed → Mon; done on Sun instead → Wed.
 * @param {Repeat} rule
 * @param {string|null} due
 * @param {string} today  YYYY-MM-DD
 */
export function nextDue(rule, due, today) {
  const base = due && due > today ? due : today;
  return rule.type === 'days' ? addDays(base, rule.every) : nextMatch(rule, base);
}

/**
 * First day strictly after `after` that matches a weekly or monthly rule.
 * @param {Repeat} rule
 * @param {string} after
 */
function nextMatch(rule, after) {
  if (rule.type === 'weekly') {
    for (let i = 1; i <= 7; i++) {
      const d = addDays(after, i);
      if (rule.days.includes(isoWeekday(d))) return d;
    }
  }
  if (rule.type === 'monthly') {
    let { y, m } = civilDate(after, 'UTC');
    for (let i = 0; i < 3; i++) {
      const d = formatDate({ y, m, d: Math.min(rule.day, daysInMonth(y, m)) });
      if (d > after) return d;
      m = m === 12 ? 1 : m + 1;
      if (m === 1) y++;
    }
  }
  return addDays(after, 1);
}

/**
 * Parses a rule as typed: "daily", "every 3 days" / "3d", "weekly" (on the weekday of `anchor`),
 * "weekdays", "mon,thu" / "weekly:mon,thu", "monthly" (on the day of `anchor`), "monthly:15";
 * "none" → null.
 * @param {string} text
 * @param {string} anchor  YYYY-MM-DD: the task's date, or today
 * @returns {Repeat | null}
 */
export function parseRepeat(text, anchor) {
  const s = text.trim().toLowerCase();
  if (['', 'none', 'no', 'off', 'never'].includes(s)) return null;
  if (s === 'daily' || s === 'every day') return { type: 'days', every: 1 };
  let m = /^(?:every\s*)?(\d+)\s*(?:d|days?)$/.exec(s);
  if (m && Number(m[1]) >= 1) return { type: 'days', every: Number(m[1]) };
  if (s === 'weekly' || s === 'every week') return { type: 'weekly', days: [isoWeekday(anchor)] };
  if (s === 'weekdays') return { type: 'weekly', days: [1, 2, 3, 4, 5] };
  if (s === 'monthly' || s === 'every month') return { type: 'monthly', day: civilDate(anchor, 'UTC').d };
  m = /^monthly\s*[:\s]\s*(\d{1,2})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) return { type: 'monthly', day: Number(m[1]) };
  const words = s.replace(/^(?:weekly\s*[:\s]|every\s)\s*/, '').split(/\s*,\s*|\s+/);
  const days = words.map(weekday);
  if (days.every((d) => d > 0)) return /** @type {Repeat} */ (validRepeat({ type: 'weekly', days }));
  throw new Error(`unknown repeat “${text}” (daily, every N days, weekly, mon,thu, weekdays, monthly, monthly:15, none)`);
}

/**
 * Short text for a rule: "daily", "every 3 d", "weekly mon,thu", "monthly 15".
 * @param {Repeat} r
 */
export function repeatText(r) {
  if (r.type === 'days') return r.every === 1 ? 'daily' : `every ${r.every} d`;
  if (r.type === 'weekly') return `weekly ${r.days.map((d) => WEEKDAYS[d - 1]).join(',')}`;
  return `monthly ${r.day}`;
}

/**
 * Parses a date as typed: YYYY-MM-DD, "today", "tomorrow", "+N" (days from today),
 * a weekday ("fri": the next one after today); "none" → null.
 * @param {string} text
 * @param {string} today  YYYY-MM-DD
 * @returns {string | null}
 */
export function parseDue(text, today) {
  const s = text.trim().toLowerCase();
  if (['', 'none', 'no', 'never'].includes(s)) return null;
  if (s === 'today') return today;
  if (s === 'tomorrow') return addDays(today, 1);
  const plus = /^\+(\d+)\s*d?$/.exec(s);
  if (plus) return addDays(today, Number(plus[1]));
  const wd = weekday(s);
  if (wd > 0) {
    for (let i = 1; i <= 7; i++) if (isoWeekday(addDays(today, i)) === wd) return addDays(today, i);
  }
  if (isDate(s)) return s;
  throw new Error(`invalid date “${text}” (YYYY-MM-DD, today, tomorrow, +N, mon…sun, none)`);
}

/**
 * Does an open task fall in a date window? "overdue": before today; "today": up to today
 * (late ones included: they still need doing); "week": up to the end of this ISO week.
 * Tasks without a date never do.
 * @param {Task} t
 * @param {'overdue'|'today'|'week'} which
 * @param {string} today
 */
export function isDueWithin(t, which, today) {
  if (!t.due) return false;
  if (which === 'overdue') return t.due < today;
  if (which === 'today') return t.due <= today;
  return t.due <= endOfWeek(today);
}

/**
 * Sorting: by date (undated last), then by creation.
 * @param {Task} a
 * @param {Task} b
 */
export function byDue(a, b) {
  if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * What tasks bring to a day view: focus ones, the dated ones up to the end of this week
 * (late ones included) and the ones with `ongoing` work. Only open tasks.
 * @param {TasksDoc} doc
 * @param {string} today  YYYY-MM-DD in the file's zone
 */
export function summary(doc, today) {
  const open = doc.tasks.filter((t) => t.status === 'open');
  return {
    focus: open.filter((t) => t.focus).sort(byDue),
    dated: open.filter((t) => isDueWithin(t, 'week', today)).sort(byDue),
    ongoing: open.filter((t) => t.ongoing).sort(byDue),
  };
}

/**
 * Applies operations to a copy of the document. Operations on tasks that no longer exist,
 * closing a task that is already closed, or focus over the limit are ignored.
 * @param {TasksDoc} doc
 * @param {Op[]} ops
 * @returns {TasksDoc}
 */
export function applyOps(doc, ops) {
  /** @type {TasksDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.tasks.find((t) => t.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.task.id)) out.tasks.push(structuredClone(op.task));
        break;
      case 'edit': {
        const t = find(op.id);
        if (t) Object.assign(t, structuredClone(op.fields));
        break;
      }
      case 'done':
      case 'drop': {
        const t = find(op.id);
        if (!t || t.status !== 'open') break;
        t.status = op.type === 'done' ? 'done' : 'dropped';
        t.doneAt = op.at;
        if (t.repeat && op.nextId && !find(op.nextId)) {
          /** @type {Task} */
          const next = {
            ...structuredClone(t), id: op.nextId, due: nextDue(t.repeat, t.due, op.today),
            subtasks: t.subtasks.map((s) => ({ ...s, done: false })), focus: false,
            status: 'open', createdAt: op.at, doneAt: null,
          };
          delete next.next;
          out.tasks.push(next);
          t.next = op.nextId;
        }
        break;
      }
      case 'reopen': {
        const t = find(op.id);
        if (!t || t.status === 'open') break;
        // The occurrence it created goes away, unless it has been closed itself meanwhile.
        if (t.next && find(t.next)?.status === 'open') out.tasks = out.tasks.filter((x) => x.id !== t.next);
        t.status = 'open';
        t.doneAt = null;
        delete t.next;
        break;
      }
      case 'focus': {
        const t = find(op.id);
        if (!t) break;
        if (!op.focus) t.focus = false;
        else if (t.status === 'open' && canFocus(out, t.id)) t.focus = true;
        break;
      }
      case 'addSub': {
        const t = find(op.id);
        if (t && !t.subtasks.some((s) => s.id === op.sub.id)) t.subtasks.push(structuredClone(op.sub));
        break;
      }
      case 'editSub': {
        const s = find(op.id)?.subtasks.find((x) => x.id === op.subId);
        if (s) s.title = op.title;
        break;
      }
      case 'toggleSub': {
        const s = find(op.id)?.subtasks.find((x) => x.id === op.subId);
        if (s) s.done = op.done;
        break;
      }
      case 'removeSub': {
        const t = find(op.id);
        if (t) t.subtasks = t.subtasks.filter((s) => s.id !== op.subId);
        break;
      }
      case 'delete':
        out.tasks = out.tasks.filter((t) => t.id !== op.id);
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
 * @param {TasksDoc} before  base document (titles of what was deleted)
 * @param {TasksDoc} after
 */
export function commitMessage(ops, before, after) {
  /** @param {string} id */
  const title = (id) =>
    after.tasks.find((t) => t.id === id)?.title ?? before.tasks.find((t) => t.id === id)?.title ?? id;
  const parts = new Set();
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new “${op.task.title}”`); break;
      case 'edit': parts.add(`${'due' in op.fields && Object.keys(op.fields).length === 1 ? 'moved' : 'edited'} “${title(op.id)}”`); break;
      case 'done': parts.add(`done “${title(op.id)}”`); break;
      case 'drop': parts.add(`dropped “${title(op.id)}”`); break;
      case 'reopen': parts.add(`reopened “${title(op.id)}”`); break;
      case 'focus': parts.add(`${op.focus ? 'focus' : 'unfocus'} “${title(op.id)}”`); break;
      case 'addSub':
      case 'editSub':
      case 'toggleSub':
      case 'removeSub': parts.add(`subtasks “${title(op.id)}”`); break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  const text = [...parts].join(', ');
  return `tasks: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}
