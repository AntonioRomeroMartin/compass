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
 * @property {string} [task]   id of the task this subtask is the same thing as: that task holds the state
 *                             (`done` here is a copy of it) and the chats of the subtask
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
 * @property {string|null} ongoing    path (inside the data repo or the domain's folder) of a text file
 *                                    with the state of the work in progress
 * @property {string|null} location   where it is done ("library", "gym")
 * @property {string|null} [event]    id of the event it prepares (lib/events.js): it moves with the event
 * @property {Status} status
 * @property {string} createdAt       ISO 8601
 * @property {string|null} doneAt     when it was closed (done or dropped)
 * @property {string} [next]          id of the occurrence created when this one was closed
 * @property {Chat[]} [sessions]       chat sessions working on it (omitted when none)
 */

/**
 * A chat session linked to a task. `id` is whatever identifies the session in the tool that runs it;
 * `title` is a copy for display. `parent` is the chat that spawned it (null: opened from the task itself),
 * which gives the hierarchy; order is by `addedAt`. `subtask` (optional) ties it to one subtask, and
 * its descendants inherit that unless they carry their own.
 * @typedef {Object} Chat
 * @property {string} id
 * @property {string} title
 * @property {string|null} parent
 * @property {string} [subtask]
 * @property {string} addedAt         ISO 8601
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
 * On a subtask that is another task, `toggleSub` closes or reopens that task (`at`, `today` and `nextId` as in
 * `done`; without `at` nothing is completed) and `removeSub` with `at` drops it too (without: it lives on).
 * @typedef {{ type: 'add', task: Task }
 *   | { type: 'edit', id: string, fields: Partial<Pick<Task, 'title'|'domain'|'due'|'notes'|'repeat'|'ongoing'|'location'|'event'>> }
 *   | { type: 'done', id: string, at: string, today: string, nextId: string | null }
 *   | { type: 'drop', id: string, at: string, today: string, nextId: string | null }
 *   | { type: 'reopen', id: string }
 *   | { type: 'focus', id: string, focus: boolean }
 *   | { type: 'addSub', id: string, sub: Subtask }
 *   | { type: 'editSub', id: string, subId: string, title: string }
 *   | { type: 'toggleSub', id: string, subId: string, done: boolean, at?: string, today?: string, nextId?: string | null }
 *   | { type: 'removeSub', id: string, subId: string, at?: string, today?: string }
 *   | { type: 'linkSub', id: string, subId: string, task: string | null }
 *   | { type: 'link', id: string, chat: Chat }
 *   | { type: 'unlink', id: string, sessions: string[] }
 *   | { type: 'relink', id: string, chat: Chat }
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
export function weekday(word) {
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
 * A chat with every field of the right type, or null if it has no id.
 * @param {any} c
 * @returns {Chat | null}
 */
function cleanChat(c) {
  if (!c || typeof c.id !== 'string' || !c.id) return null;
  return {
    id: c.id, title: typeof c.title === 'string' ? c.title : '', parent: typeof c.parent === 'string' ? c.parent : null,
    ...(typeof c.subtask === 'string' && c.subtask ? { subtask: c.subtask } : {}),
    addedAt: typeof c.addedAt === 'string' ? c.addedAt : '',
  };
}

/**
 * Valid chats of a task (copied): no repeated ids, and a parent that is not in the task becomes null.
 * @param {any} raw
 * @returns {Chat[]}
 */
function normalizeChats(raw) {
  /** @type {Chat[]} */
  const chats = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const chat = cleanChat(c);
    if (chat && !chats.some((x) => x.id === chat.id)) chats.push(chat);
  }
  for (const c of chats) if (c.parent === c.id || (c.parent && !chats.some((x) => x.id === c.parent))) c.parent = null;
  return chats;
}

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
      // `goal` (a goal that got +1 when the task was completed) is no longer used.
      const { goal: _goal, ...rest } = t;
      const task = {
        ...rest,
        domain: typeof t.domain === 'string' ? t.domain : '',
        due: isDate(t.due) ? t.due : null,
        notes: textOrNull(t.notes),
        subtasks: (Array.isArray(t.subtasks) ? t.subtasks : [])
          .filter((/** @type {any} */ s) => s && typeof s.id === 'string' && typeof s.title === 'string')
          .map((/** @type {any} */ s) => ({ id: s.id, title: s.title, done: s.done === true, ...(typeof s.task === 'string' && s.task ? { task: s.task } : {}) })),
        repeat: validRepeat(t.repeat),
        focus: t.focus === true,
        ongoing: textOrNull(t.ongoing),
        location: textOrNull(t.location),
        status: STATUSES.includes(t.status) ? t.status : 'open',
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
        doneAt: textOrNull(t.doneAt),
      };
      if (typeof task.next !== 'string') delete task.next;
      const chats = normalizeChats(t.sessions);
      if (chats.length) task.sessions = chats;
      else delete task.sessions;
      if (typeof task.event !== 'string' || !task.event) delete task.event;
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
    id: newId('t_'), due: null, notes: null, subtasks: [], repeat: null, focus: false, ongoing: null,
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
 * Does an open task fall in a date window? "overdue": before today; "today": up to today (late ones included:
 * they still need doing); "week": up to the end of this ISO week; "next7": up to 7 days from today, whatever the
 * weekday (on a Friday it still shows next Wednesday). Tasks without a date never do.
 * @param {Task} t
 * @param {'overdue'|'today'|'week'|'next7'} which
 * @param {string} today
 */
export function isDueWithin(t, which, today) {
  if (!t.due) return false;
  if (which === 'overdue') return t.due < today;
  if (which === 'today') return t.due <= today;
  if (which === 'next7') return t.due <= addDays(today, 7);
  return t.due <= endOfWeek(today);
}

/** Closed tasks stay in tasks.json this many days; after that they move to the yearly archive. */
export const ARCHIVE_AFTER_DAYS = 30;

/**
 * Splits off the tasks closed (done or dropped) more than ARCHIVE_AFTER_DAYS ago, by the year they were closed,
 * so tasks.json stays small (the app downloads it often; the GitHub API reads at most 1 MB per file).
 * @param {TasksDoc} doc
 * @param {string} today  YYYY-MM-DD
 * @returns {{ doc: TasksDoc, byYear: Record<string, Task[]> }}  what stays, and what goes to each year's archive
 */
export function splitArchive(doc, today) {
  const limit = addDays(today, -ARCHIVE_AFTER_DAYS);
  /** @type {Record<string, Task[]>} */
  const byYear = {};
  const keep = [];
  for (const t of doc.tasks) {
    const closed = t.status !== 'open' && t.doneAt ? t.doneAt.slice(0, 10) : null;
    if (closed && closed < limit) (byYear[closed.slice(0, 4)] ??= []).push(t);
    else keep.push(t);
  }
  return { doc: { ...doc, tasks: keep }, byYear };
}

/**
 * Archive file of a year, next to tasks.json: "data/tasks.json" → "data/tasks-2026.json".
 * @param {string} tasksPath @param {string} year
 */
export const archivePath = (tasksPath, year) => tasksPath.replace(/(\.json)?$/, `-${year}.json`);

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
    dated: open.filter((t) => isDueWithin(t, 'next7', today)).sort(byDue),
    ongoing: open.filter((t) => t.ongoing).sort(byDue),
  };
}

/**
 * A task's chats as a tree: roots are the chats opened from the task itself; every level sorted by `addedAt`.
 * @param {Task} t
 * @returns {{ chat: Chat, children: any[] }[]}
 */
export function chatTree(t) {
  const chats = t.sessions ?? [];
  /** @param {string|null} parent @returns {{ chat: Chat, children: any[] }[]} */
  const level = (parent) =>
    chats.filter((c) => c.parent === parent).sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0))
      .map((chat) => ({ chat, children: level(chat.id) }));
  return level(null);
}

/**
 * Subtask a chat belongs to: its own, or the nearest ancestor's (undefined: the task as a whole).
 * @param {Task} t
 * @param {string} chatId
 */
export function chatSubtask(t, chatId) {
  const chats = t.sessions ?? [];
  const seen = new Set();
  for (let c = chats.find((x) => x.id === chatId); c && !seen.has(c.id); c = chats.find((x) => x.id === c?.parent)) {
    if (c.subtask) return c.subtask;
    seen.add(c.id);
  }
  return undefined;
}

/**
 * Chats that belong to a subtask (their own or inherited): what goes when it is completed.
 * @param {Task} t
 * @param {string} subId
 */
export const chatsOfSubtask = (t, subId) => (t.sessions ?? []).filter((c) => chatSubtask(t, c.id) === subId);

/**
 * Removes chats from a task; their children move up to the removed chat's parent.
 * @param {Task} t @param {Set<string>} gone
 */
function removeChats(t, gone) {
  const chats = t.sessions ?? [];
  /** @param {string|null} id */
  const survivor = (id) => {
    let p = id;
    for (let i = 0; p && gone.has(p) && i <= chats.length; i++) p = chats.find((x) => x.id === p)?.parent ?? null;
    return p;
  };
  const rest = chats.filter((c) => !gone.has(c.id)).map((c) => ({ ...c, parent: survivor(c.parent) }));
  if (rest.length) t.sessions = rest;
  else delete t.sessions;
}

/**
 * Subtasks (in any task) that are the same thing as a task.
 * @param {TasksDoc} doc @param {string} taskId
 * @returns {{ task: Task, sub: Subtask }[]}
 */
export function linkedSubtasks(doc, taskId) {
  return doc.tasks.flatMap((task) => task.subtasks.filter((sub) => sub.task === taskId).map((sub) => ({ task, sub })));
}

/**
 * The task a subtask is the same thing as, if it exists.
 * @param {TasksDoc} doc @param {Subtask} sub
 */
export const linkedTask = (doc, sub) => (sub.task ? doc.tasks.find((t) => t.id === sub.task) : undefined);

/**
 * State of a subtask: a subtask that is a dropped task counts as dropped (neither done nor left to do).
 * @param {TasksDoc} doc @param {Subtask} sub
 * @returns {'done'|'open'|'dropped'}
 */
export function subtaskState(doc, sub) {
  if (linkedTask(doc, sub)?.status === 'dropped') return 'dropped';
  return sub.done ? 'done' : 'open';
}

/**
 * Subtasks done out of the ones that count (the dropped ones do not).
 * @param {TasksDoc} doc @param {Task} t
 */
export function subtaskProgress(doc, t) {
  const states = t.subtasks.map((s) => subtaskState(doc, s)).filter((s) => s !== 'dropped');
  return { done: states.filter((s) => s === 'done').length, total: states.length };
}

/**
 * Removes a subtask; chats that were tied to it go back to the task as a whole.
 * @param {Task} t @param {string} subId
 */
function dropSubtask(t, subId) {
  t.subtasks = t.subtasks.filter((s) => s.id !== subId);
  for (const c of t.sessions ?? []) if (c.subtask === subId) delete c.subtask;
}

/**
 * Applies operations to a copy of the document. Operations on tasks that no longer exist,
 * closing a task that is already closed, or focus over the limit are ignored.
 * A subtask that is another task (`task`) always ends up with that task's state, whoever changed what.
 * @param {TasksDoc} doc
 * @param {Op[]} ops
 * @returns {TasksDoc}
 */
export function applyOps(doc, ops) {
  /** @type {TasksDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.tasks.find((t) => t.id === id);
  /**
   * Closes a task. Dropping it also drops the open tasks its subtasks are (unless another open task has them as
   * a subtask too), with the same timestamp, so that reopening it brings back exactly those.
   * @param {Task} t @param {'done'|'drop'} type @param {string} at @param {string} today @param {string|null} nextId
   */
  const close = (t, type, at, today, nextId) => {
    if (t.status !== 'open') return;
    t.status = type === 'done' ? 'done' : 'dropped';
    t.doneAt = at;
    if (t.repeat && nextId && !find(nextId)) {
      /** @type {Task} */
      const next = {
        ...structuredClone(t), id: nextId, due: nextDue(t.repeat, t.due, today),
        // A subtask that was another task starts over as a plain step: that task is closed.
        subtasks: t.subtasks.map(({ task: _task, ...s }) => ({ ...s, done: false })), focus: false,
        status: 'open', createdAt: at, doneAt: null,
      };
      delete next.next;
      delete next.sessions; // chats belong to the occurrence they were opened for
      out.tasks.push(next);
      t.next = nextId;
    }
    if (type !== 'drop') return;
    for (const s of t.subtasks) {
      const owner = linkedTask(out, s);
      if (owner && !linkedSubtasks(out, owner.id).some((l) => l.task.id !== t.id && l.task.status === 'open')) close(owner, 'drop', at, today, null);
    }
  };
  /** @param {Task} t */
  const reopen = (t) => {
    if (t.status === 'open') return;
    const { status, doneAt } = t;
    // The occurrence it created goes away, unless it has been closed itself meanwhile.
    if (t.next && find(t.next)?.status === 'open') out.tasks = out.tasks.filter((x) => x.id !== t.next);
    t.status = 'open';
    t.doneAt = null;
    delete t.next;
    // What was dropped along with it comes back with it.
    if (status === 'dropped') for (const s of t.subtasks) {
      const owner = linkedTask(out, s);
      if (owner && owner.status === 'dropped' && owner.doneAt === doneAt) reopen(owner);
    }
  };
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.task.id)) out.tasks.push(structuredClone(op.task));
        break;
      case 'edit': {
        const t = find(op.id);
        if (t) Object.assign(t, structuredClone(op.fields));
        if (t && !t.event) delete t.event;
        break;
      }
      case 'done':
      case 'drop': {
        const t = find(op.id);
        if (t) close(t, op.type, op.at, op.today, op.nextId);
        break;
      }
      case 'reopen': {
        const t = find(op.id);
        if (t) reopen(t);
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
        if (!s) break;
        s.done = op.done;
        const owner = linkedTask(out, s);
        if (owner && op.done && op.at) close(owner, 'done', op.at, op.today ?? op.at.slice(0, 10), op.nextId ?? null);
        else if (owner && !op.done) reopen(owner);
        break;
      }
      case 'removeSub': {
        const t = find(op.id);
        if (!t) break;
        const owner = linkedTask(out, t.subtasks.find((x) => x.id === op.subId) ?? { id: '', title: '', done: false });
        dropSubtask(t, op.subId);
        if (owner && op.at) close(owner, 'drop', op.at, op.today ?? op.at.slice(0, 10), null);
        break;
      }
      case 'linkSub': {
        const t = find(op.id);
        const sub = t?.subtasks.find((x) => x.id === op.subId);
        if (!t || !sub) break;
        const owner = op.task && op.task !== t.id ? find(op.task) : undefined;
        if (op.task && !owner) break;
        if (!owner) {
          delete sub.task;
          break;
        }
        sub.task = owner.id;
        // The subtask's chats move to the task that now owns them.
        const moving = chatsOfSubtask(t, sub.id).map((c) => ({ ...c }));
        const ids = new Set(moving.map((c) => c.id));
        removeChats(t, ids);
        for (const c of moving) {
          delete c.subtask;
          if (c.parent && !ids.has(c.parent)) c.parent = null;
          if (!owner.sessions?.some((x) => x.id === c.id)) (owner.sessions ??= []).push(c);
        }
        break;
      }
      case 'link':
      case 'relink': {
        let t = find(op.id);
        if (!t || !op.chat.id) break;
        // A chat belongs to one task: `link` leaves it where it is, `relink` moves it here.
        if (out.tasks.some((x) => x.sessions?.some((c) => c.id === op.chat.id))) {
          if (op.type === 'link') break;
          for (const x of out.tasks) if (x.sessions?.some((c) => c.id === op.chat.id)) removeChats(x, new Set([op.chat.id]));
        }
        const chat = cleanChat(op.chat);
        if (!chat) break;
        // A chat about a subtask that is another task lives in that task.
        const owner = chat.subtask ? linkedTask(out, t.subtasks.find((s) => s.id === chat.subtask) ?? { id: '', title: '', done: false }) : undefined;
        if (owner) {
          t = owner;
          delete chat.subtask;
        }
        if (chat.parent && !t.sessions?.some((c) => c.id === chat.parent)) chat.parent = null;
        if (chat.subtask && !t.subtasks.some((s) => s.id === chat.subtask)) delete chat.subtask;
        (t.sessions ??= []).push(chat);
        break;
      }
      case 'unlink': {
        const t = find(op.id);
        if (t) removeChats(t, new Set(op.sessions));
        break;
      }
      case 'delete':
        for (const l of linkedSubtasks(out, op.id)) dropSubtask(l.task, l.sub.id);
        out.tasks = out.tasks.filter((t) => t.id !== op.id);
        break;
      case 'setTimeZone':
        out.timeZone = op.timeZone;
        break;
    }
  }
  // A subtask that is another task has no state of its own: it is done when that task is.
  for (const t of out.tasks) for (const s of t.subtasks) {
    const owner = linkedTask(out, s);
    if (owner) s.done = owner.status === 'done';
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
      case 'linkSub':
      case 'removeSub': parts.add(`subtasks “${title(op.id)}”`); break;
      case 'link':
      case 'unlink':
      case 'relink': parts.add(`chats “${title(op.id)}”`); break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  const text = [...parts].join(', ');
  return `tasks: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}
