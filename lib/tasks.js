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
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} domain          domain id (see lib/domains.js); required
 * @property {string|null} due        YYYY-MM-DD
 * @property {string|null} notes
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
 * @property {string} [parent]        id of the task it is a part of (omitted at the top). A subtask is a task
 *                                    like any other: its own domain, date, chats and subtasks
 * @property {Chat[]} [sessions]       chat sessions working on it (omitted when none)
 */

/**
 * A chat session linked to a task. `id` is whatever identifies the session in the tool that runs it;
 * `title` is a copy for display. `parent` is the chat that spawned it (null: opened from the task itself),
 * which gives the hierarchy; order is by `addedAt`.
 * @typedef {Object} Chat
 * @property {string} id
 * @property {string} title
 * @property {string|null} parent
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
 * Closing a task closes the open tasks under it, and reopening it brings back exactly those.
 * @typedef {{ type: 'add', task: Task }
 *   | { type: 'edit', id: string, fields: Partial<Pick<Task, 'title'|'domain'|'due'|'notes'|'repeat'|'ongoing'|'location'|'event'|'parent'>> }
 *   | { type: 'done', id: string, at: string, today: string, nextId: string | null }
 *   | { type: 'drop', id: string, at: string, today: string, nextId: string | null }
 *   | { type: 'reopen', id: string }
 *   | { type: 'focus', id: string, focus: boolean }
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
 * The older shape, a `subtasks` list inside each task, is read as tasks with `parent`: a subtask keeps its id
 * (or gets one made from it and its task's, when another task has it), one that pointed at another task (`task`)
 * makes that task its part, and the chats that were tied to a subtask go to it.
 * @param {any} raw
 * @returns {TasksDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const list = (Array.isArray(doc.tasks) ? doc.tasks : [])
    .filter((/** @type {any} */ t) => t && typeof t.id === 'string' && typeof t.title === 'string');
  const taken = new Set(list.map((/** @type {any} */ t) => t.id));
  /** @type {Task[]} */
  const tasks = [];
  /** @type {[string, string][]} [task, parent]: tasks that were pointed at by a subtask */
  const adopted = [];
  /** @type {[string, Chat][]} [task, chat]: chats that were tied to a subtask */
  const moved = [];
  for (const t of list) {
    // `goal` (a goal that got +1 when the task was completed) is no longer used.
    const { goal: _goal, subtasks: legacy, ...rest } = t;
    /** @type {Task} */
    const task = {
      ...rest,
      domain: typeof t.domain === 'string' ? t.domain : '',
      due: isDate(t.due) ? t.due : null,
      notes: textOrNull(t.notes),
      repeat: validRepeat(t.repeat),
      focus: t.focus === true,
      ongoing: textOrNull(t.ongoing),
      location: textOrNull(t.location),
      status: STATUSES.includes(t.status) ? t.status : 'open',
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
      doneAt: textOrNull(t.doneAt),
    };
    if (typeof task.next !== 'string') delete task.next;
    if (typeof task.parent !== 'string' || !task.parent || task.parent === task.id) delete task.parent;
    if (typeof task.event !== 'string' || !task.event) delete task.event;
    let chats = normalizeChats(t.sessions);
    tasks.push(task);

    /** @type {Map<string, string>} subtask id → the task it is now */
    const became = new Map();
    for (const s of Array.isArray(legacy) ? legacy : []) {
      if (!s || typeof s.id !== 'string' || typeof s.title !== 'string') continue;
      if (typeof s.task === 'string' && s.task !== t.id && taken.has(s.task)) {
        became.set(s.id, s.task);
        adopted.push([s.task, t.id]);
        continue;
      }
      let id = s.id;
      while (taken.has(id)) id = `${id}-${t.id}`;
      taken.add(id);
      became.set(s.id, id);
      // A step left undone in a closed task was closed with it.
      const status = s.done === true ? 'done' : task.status;
      tasks.push({
        id, title: s.title, domain: task.domain, due: null, notes: null, repeat: null, focus: false, ongoing: null,
        location: null, status, createdAt: task.createdAt, doneAt: status === 'open' ? null : task.doneAt ?? task.createdAt,
        parent: t.id,
      });
    }
    if (became.size && chats.length) {
      /** @param {string} id the subtask a chat was about: its own or the nearest ancestor's */
      const about = (id) => {
        const seen = new Set();
        for (let c = t.sessions.find((/** @type {any} */ x) => x?.id === id); c && !seen.has(c.id); c = t.sessions.find((/** @type {any} */ x) => x?.id === c.parent)) {
          if (typeof c.subtask === 'string' && c.subtask) return became.get(c.subtask);
          seen.add(c.id);
        }
        return undefined;
      };
      for (const c of chats) {
        const to = about(c.id);
        if (to) moved.push([to, c]);
      }
      chats = normalizeChats(chats.filter((c) => !moved.some(([, m]) => m === c)));
    }
    if (chats.length) task.sessions = chats;
    else delete task.sessions;
  }
  /** @param {string} id */
  const find = (id) => tasks.find((x) => x.id === id);
  for (const [id, chat] of moved) {
    const to = find(id);
    if (to && !tasks.some((x) => x.sessions?.some((c) => c.id === chat.id))) to.sessions = normalizeChats([...(to.sessions ?? []), chat]);
  }
  for (const [id, parent] of adopted) {
    const child = find(id);
    if (child && !child.parent) child.parent = parent;
  }
  // No loops: a task that is (indirectly) its own parent goes back to the top.
  for (const t of tasks) {
    const seen = new Set([t.id]);
    for (let p = t.parent ? find(t.parent) : undefined; p; p = p.parent ? find(p.parent) : undefined) {
      if (seen.has(p.id)) { delete t.parent; break; }
      seen.add(p.id);
    }
  }
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
    id: newId('t_'), due: null, notes: null, repeat: null, focus: false, ongoing: null,
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
 * A task that is part of another one only goes when that one does.
 * @param {TasksDoc} doc
 * @param {string} today  YYYY-MM-DD
 * @returns {{ doc: TasksDoc, byYear: Record<string, Task[]> }}  what stays, and what goes to each year's archive
 */
export function splitArchive(doc, today) {
  const limit = addDays(today, -ARCHIVE_AFTER_DAYS);
  /** @param {Task} t */
  const closed = (t) => (t.status !== 'open' && t.doneAt ? t.doneAt.slice(0, 10) : null);
  const going = new Set(doc.tasks.filter((t) => (closed(t) ?? limit) < limit).map((t) => t.id));
  // A part stays while its task does: the task still counts it.
  for (let again = true; again;) {
    again = false;
    for (const t of doc.tasks) {
      if (going.has(t.id) && t.parent && !going.has(t.parent) && doc.tasks.some((x) => x.id === t.parent)) {
        going.delete(t.id);
        again = true;
      }
    }
  }
  /** @type {Record<string, Task[]>} */
  const byYear = {};
  for (const t of doc.tasks) if (going.has(t.id)) (byYear[/** @type {string} */ (closed(t)).slice(0, 4)] ??= []).push(t);
  return { doc: { ...doc, tasks: doc.tasks.filter((t) => !going.has(t.id)) }, byYear };
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
 * The tasks that are part of a task, in the order of the file.
 * @param {TasksDoc} doc @param {string} id
 */
export const children = (doc, id) => doc.tasks.filter((t) => t.parent === id);

/**
 * Everything under a task: its parts, their parts… each one right after its parent.
 * @param {TasksDoc} doc @param {string} id
 * @returns {Task[]}
 */
export function descendants(doc, id) {
  const seen = new Set([id]);
  /** @param {string} of @returns {Task[]} */
  const walk = (of) => children(doc, of).filter((c) => !seen.has(c.id)).flatMap((c) => (seen.add(c.id), [c, ...walk(c.id)]));
  return walk(id);
}

/**
 * The task a task is part of, if it is in the document.
 * @param {TasksDoc} doc @param {Task} t
 */
export const parentOf = (doc, t) => (t.parent ? doc.tasks.find((x) => x.id === t.parent) : undefined);

/**
 * Parts of a task done out of the ones that count (the dropped ones do not).
 * @param {TasksDoc} doc @param {Task} t
 */
export function progress(doc, t) {
  const parts = children(doc, t.id).filter((c) => c.status !== 'dropped');
  return { done: parts.filter((c) => c.status === 'done').length, total: parts.length };
}

/**
 * Is a task a plain step of an open task (no date, same domain)? Steps are listed under their task; anything else
 * gets a line of its own.
 * @param {TasksDoc} doc @param {Task} t
 * @param {(domain: string) => string} [canon]  canonical id of a domain (lib/domains.js)
 */
export function isStep(doc, t, canon = (d) => d) {
  const p = parentOf(doc, t);
  return !!p && p.status === 'open' && !t.due && canon(t.domain) === canon(p.domain);
}

/**
 * Whole days from one civil date to another.
 * @param {string} from @param {string} to
 */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

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
  /**
   * Can a task be part of another one? That one must exist and not be the task itself or something under it.
   * @param {string} id @param {string} parent
   */
  const fits = (id, parent) => parent !== id && !!find(parent) && !descendants(out, id).some((d) => d.id === parent);
  /**
   * Closes a task and, with the same timestamp, the open tasks under it, so that reopening it brings back exactly
   * those. A repeating task gets its next occurrence, with a fresh copy of what was under it.
   * @param {Task} t @param {'done'|'drop'} type @param {string} at @param {string} today @param {string|null} nextId
   */
  const close = (t, type, at, today, nextId) => {
    if (t.status !== 'open') return;
    /** @type {Task[]} what is under it, leaving out what had been dropped (and what hangs from that) */
    const under = [];
    /** @param {string} id */
    const walk = (id) => {
      for (const c of children(out, id)) {
        if (c.status === 'dropped' || under.includes(c)) continue;
        under.push(c);
        walk(c.id);
      }
    };
    walk(t.id);
    t.status = type === 'done' ? 'done' : 'dropped';
    t.doneAt = at;
    for (const d of under) {
      if (d.status !== 'open') continue;
      d.status = t.status;
      d.doneAt = at;
    }
    if (!t.repeat || !nextId || find(nextId)) return;
    const due = nextDue(t.repeat, t.due, today);
    const shift = t.due ? daysBetween(t.due, due) : 0;
    /** @type {Map<string, string>} */
    const ids = new Map([[t.id, nextId]]);
    under.forEach((d, i) => ids.set(d.id, `${nextId}-${i + 1}`));
    for (const src of [t, ...under]) {
      /** @type {Task} */
      const copy = {
        ...structuredClone(src), id: /** @type {string} */ (ids.get(src.id)), focus: false, status: 'open', createdAt: at, doneAt: null,
        due: src === t ? due : src.due && t.due ? addDays(src.due, shift) : null,
      };
      delete copy.next;
      delete copy.sessions; // chats belong to the occurrence they were opened for
      if (src !== t) copy.parent = ids.get(/** @type {string} */ (src.parent));
      out.tasks.push(copy);
    }
    t.next = nextId;
  };
  /** @param {Task} t */
  const reopen = (t) => {
    if (t.status === 'open') return;
    const { status, doneAt } = t;
    // The occurrence it created goes away (with what is under it), unless it has been closed itself meanwhile.
    if (t.next && find(t.next)?.status === 'open') {
      const gone = new Set([t.next, ...descendants(out, t.next).map((d) => d.id)]);
      out.tasks = out.tasks.filter((x) => !gone.has(x.id));
    }
    t.status = 'open';
    t.doneAt = null;
    delete t.next;
    // What was closed along with it comes back with it.
    for (const d of descendants(out, t.id)) {
      if (d.status === status && d.doneAt === doneAt) {
        d.status = 'open';
        d.doneAt = null;
      }
    }
  };
  for (const op of ops) {
    switch (op.type) {
      case 'add': {
        if (find(op.task.id)) break;
        const t = structuredClone(op.task);
        if (!t.parent || !find(t.parent)) delete t.parent;
        out.tasks.push(t);
        break;
      }
      case 'edit': {
        const t = find(op.id);
        if (!t) break;
        const { parent, ...fields } = structuredClone(op.fields);
        Object.assign(t, fields);
        if (!t.event) delete t.event;
        if ('parent' in op.fields) {
          if (!parent) delete t.parent;
          else if (fits(t.id, parent)) t.parent = parent;
        }
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
      case 'link':
      case 'relink': {
        const t = find(op.id);
        if (!t || !op.chat.id) break;
        // A chat belongs to one task: `link` leaves it where it is, `relink` moves it here.
        if (out.tasks.some((x) => x.sessions?.some((c) => c.id === op.chat.id))) {
          if (op.type === 'link') break;
          for (const x of out.tasks) if (x.sessions?.some((c) => c.id === op.chat.id)) removeChats(x, new Set([op.chat.id]));
        }
        const chat = cleanChat(op.chat);
        if (!chat) break;
        if (chat.parent && !t.sessions?.some((c) => c.id === chat.parent)) chat.parent = null;
        (t.sessions ??= []).push(chat);
        break;
      }
      case 'unlink': {
        const t = find(op.id);
        if (t) removeChats(t, new Set(op.sessions));
        break;
      }
      case 'delete': {
        // What is under it goes with it.
        const gone = new Set([op.id, ...descendants(out, op.id).map((d) => d.id)]);
        out.tasks = out.tasks.filter((t) => !gone.has(t.id));
        break;
      }
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
