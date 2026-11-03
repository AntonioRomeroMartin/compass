// @ts-check
// Data model of events.json and edit operations (same shape as the other data files: normalize, applyOps
// re-applied on the latest version, serialize, commitMessage).
//
// An event is something that happens at a given day or time (an exam, a deadline, a trip). compass is where it is
// kept; a calendar only shows a copy of it (see lib/calendar.js). The work to prepare it is a task that points to the
// event (`task.event`): when the event moves, its open tasks move by the same number of days.
//
// `start` and `end` are civil times in the file's `timeZone`: "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM". An all-day
// event's `end` is its last day (null: one day); a timed event's `end` is when it ends (null: one hour).

import { addDays, daysUntil, isDate } from './period.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

/**
 * The fields a calendar copy is made of.
 * @typedef {Object} Fields
 * @property {string} title
 * @property {string} start
 * @property {string|null} end
 * @property {string|null} location
 * @property {string|null} notes
 */

/**
 * The link to the calendar copy: its id and the fields both sides had after the last sync (to tell which side
 * changed since).
 * @typedef {Object} Link
 * @property {string} id         the calendar's event id
 * @property {string} calendar   the calendar it is in
 * @property {Fields} last
 */

/**
 * @typedef {Fields & {
 *   id: string,
 *   domain: string,
 *   createdAt: string,
 *   cal: Link|null,
 * }} Event
 */

/**
 * @typedef {Object} EventsDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of the civil times
 * @property {Event[]} events
 * @property {{ id: string, calendar: string }[]} removed  calendar copies of deleted events, still to delete there
 * @property {string} [checkedAt]  last time a sync read the calendar (ISO 8601)
 */

/** @typedef {Partial<Pick<Event, 'title'|'domain'|'start'|'end'|'location'|'notes'>>} EventFields */

/**
 * @typedef {{ type: 'add', event: Event }
 *   | { type: 'edit', id: string, fields: EventFields }
 *   | { type: 'link', id: string, cal: Link|null }
 *   | { type: 'unremove', calId: string }
 *   | { type: 'delete', id: string }
 *   | { type: 'checked', at: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** Fields a calendar copy is compared on. */
export const FIELDS = /** @type {const} */ (['title', 'start', 'end', 'location', 'notes']);

/** @param {string} [timeZone] @returns {EventsDoc} */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), events: [], removed: [] };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Is it "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"? @param {unknown} v @returns {v is string} */
export function isWhen(v) {
  if (typeof v !== 'string') return false;
  const [date, time, ...more] = v.split('T');
  return !more.length && isDate(date) && (time === undefined || TIME.test(time));
}

/** @param {string} when */
export const isAllDay = (when) => !when.includes('T');
/** @param {string} when */
export const dayOf = (when) => when.slice(0, 10);
/** @param {string} when */
export const timeOf = (when) => when.slice(11, 16);

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** @param {any} f @returns {Fields|null} */
function fieldsOrNull(f) {
  if (!f || typeof f !== 'object' || typeof f.title !== 'string' || !isWhen(f.start)) return null;
  return { title: f.title, start: f.start, end: isWhen(f.end) ? f.end : null, location: textOrNull(f.location), notes: textOrNull(f.notes) };
}

/**
 * Normalizes a document that was read (tolerates missing fields; drops events without id, title or start).
 * @param {any} raw
 * @returns {EventsDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const events = (Array.isArray(doc.events) ? doc.events : [])
    .filter((/** @type {any} */ x) => x && typeof x.id === 'string' && typeof x.title === 'string' && x.title.trim() && isWhen(x.start))
    .map((/** @type {any} */ x) => {
      const last = fieldsOrNull(x.cal?.last);
      const linked = typeof x.cal?.id === 'string' && typeof x.cal?.calendar === 'string' && last;
      return /** @type {Event} */ ({
        ...x,
        domain: typeof x.domain === 'string' ? x.domain : '',
        end: isWhen(x.end) ? x.end : null,
        location: textOrNull(x.location),
        notes: textOrNull(x.notes),
        createdAt: typeof x.createdAt === 'string' ? x.createdAt : '',
        cal: linked ? { id: x.cal.id, calendar: x.cal.calendar, last } : null,
      });
    });
  const removed = (Array.isArray(doc.removed) ? doc.removed : [])
    .filter((/** @type {any} */ r) => r && typeof r.id === 'string' && typeof r.calendar === 'string')
    .map((/** @type {any} */ r) => ({ id: r.id, calendar: r.calendar }));
  return { ...doc, version: Number(doc.version) || 1, events, removed };
}

/**
 * New event with every field filled in.
 * @param {Pick<Event, 'title'|'domain'|'start'> & Partial<Event>} fields
 * @param {Date} [now]
 * @returns {Event}
 */
export function newEvent(fields, now = new Date()) {
  return { id: newId('e_'), end: null, location: null, notes: null, cal: null, createdAt: now.toISOString(), ...fields };
}

/** The fields of an event (what its calendar copy shows). @param {Fields} e @returns {Fields} */
export const fieldsOf = (e) => ({ title: e.title, start: e.start, end: e.end, location: e.location, notes: e.notes });

/**
 * Do two sets of fields match?
 * @param {Fields} a @param {Fields} b @param {readonly (keyof Fields)[]} [keys]
 */
export const sameFields = (a, b, keys = FIELDS) => keys.every((k) => (a[k] ?? null) === (b[k] ?? null));

/**
 * Start and end from what is typed: a day, an optional time ("14:30" or "14:30-16:00") and an optional last day.
 * @param {string} date  YYYY-MM-DD
 * @param {string|null} [time]
 * @param {string|null} [until]  last day (all-day events) or day it ends (timed ones), YYYY-MM-DD
 * @returns {{ start: string, end: string|null }}
 */
export function parseWhen(date, time = null, until = null) {
  if (!isDate(date)) throw new Error(`invalid date “${date}” (YYYY-MM-DD)`);
  if (until !== null && !isDate(until)) throw new Error(`invalid date “${until}” (YYYY-MM-DD)`);
  if (until !== null && until < date) throw new Error('the event cannot end before it starts');
  if (!time) return { start: date, end: until && until !== date ? until : null };
  const [from, to, ...more] = time.split('-').map((s) => s.trim().padStart(5, '0'));
  if (more.length || !TIME.test(from) || (to !== undefined && !TIME.test(to))) throw new Error(`invalid time “${time}” (HH:MM or HH:MM-HH:MM)`);
  const start = `${date}T${from}`;
  const end = to === undefined ? null : `${until ?? date}T${to}`;
  if (end !== null && end <= start) throw new Error('the event must end after it starts');
  return { start, end };
}

/** Last day the event takes up. @param {Fields} e */
export const lastDay = (e) => dayOf(e.end ?? e.start);

/** Days between the starts of two times ("2026-01-12" → "2026-01-14T10:00" = 2). @param {string} from @param {string} to */
export const daysBetween = (from, to) => daysUntil(dayOf(to), dayOf(from), 'UTC');

/** Is it over by `today`? @param {Fields} e @param {string} today */
export const isPast = (e, today) => lastDay(e) < today;

/** Order: by start. @param {Fields} a @param {Fields} b */
export const byStart = (a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title);

/**
 * Events from today on (the ones still going on too), in the next `days` days (all of them without `days`).
 * @param {EventsDoc} doc @param {string} today @param {number} [days]
 */
export function upcoming(doc, today, days) {
  const until = days === undefined ? null : addDays(today, days);
  return doc.events.filter((e) => !isPast(e, today) && (!until || dayOf(e.start) <= until)).sort(byStart);
}

/** "Wed 4 Nov 14:30–16:00", "Fri 11 Dec", "4–7 Jan". @param {Fields} e */
export function whenText(e) {
  /** @param {string} d @param {Intl.DateTimeFormatOptions} o */
  const f = (d, o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(new Date(`${d}T00:00:00Z`));
  const day = dayOf(e.start);
  const head = f(day, { weekday: 'short', day: 'numeric', month: 'short' });
  if (isAllDay(e.start)) return e.end ? `${head} – ${f(e.end, { weekday: 'short', day: 'numeric', month: 'short' })}` : head;
  if (!e.end) return `${head} ${timeOf(e.start)}`;
  return dayOf(e.end) === day ? `${head} ${timeOf(e.start)}–${timeOf(e.end)}` : `${head} ${timeOf(e.start)} – ${f(dayOf(e.end), { day: 'numeric', month: 'short' })} ${timeOf(e.end)}`;
}

/**
 * Moves an event's start (and its end with it, keeping the length) to another day.
 * @param {Fields} e @param {string} day YYYY-MM-DD
 * @returns {Pick<Fields, 'start'|'end'>}
 */
export function moveTo(e, day) {
  const n = daysBetween(e.start, day);
  /** @param {string} w */
  const shift = (w) => `${addDays(dayOf(w), n)}${w.slice(10)}`;
  return { start: shift(e.start), end: e.end && shift(e.end) };
}

/**
 * The open tasks of an event (`task.event`) moved by the days its start moved.
 * @param {import('./tasks.js').TasksDoc} doc @param {string} id @param {string} from @param {string} to  old and new start
 * @returns {import('./tasks.js').Op[]}
 */
export function tasksToMove(doc, id, from, to) {
  const n = daysBetween(from, to);
  if (!n) return [];
  return doc.tasks.filter((t) => t.event === id && t.status === 'open' && t.due)
    .map((t) => ({ type: 'edit', id: t.id, fields: { due: addDays(/** @type {string} */ (t.due), n) } }));
}

/**
 * Applies operations to a copy of the document. Operations on events that no longer exist are ignored.
 * Deleting an event that has a calendar copy keeps that copy in `removed`, until the calendar deletes it too.
 * @param {EventsDoc} doc
 * @param {Op[]} ops
 * @returns {EventsDoc}
 */
export function applyOps(doc, ops) {
  /** @type {EventsDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.events.find((x) => x.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.event.id)) out.events.push(structuredClone(op.event));
        break;
      case 'edit': {
        const e = find(op.id);
        if (e) Object.assign(e, structuredClone(op.fields));
        break;
      }
      case 'link': {
        const e = find(op.id);
        if (e) e.cal = structuredClone(op.cal);
        break;
      }
      case 'unremove':
        out.removed = out.removed.filter((r) => r.id !== op.calId);
        break;
      case 'delete': {
        const e = find(op.id);
        if (e?.cal && !out.removed.some((r) => r.id === e.cal?.id)) out.removed.push({ id: e.cal.id, calendar: e.cal.calendar });
        out.events = out.events.filter((x) => x.id !== op.id);
        break;
      }
      case 'checked':
        if (!out.checkedAt || op.at > out.checkedAt) out.checkedAt = op.at;
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
 * @param {EventsDoc} before  base document (titles of what was deleted)
 * @param {EventsDoc} after
 */
export function commitMessage(ops, before, after) {
  /** @param {string} id */
  const title = (id) => after.events.find((x) => x.id === id)?.title ?? before.events.find((x) => x.id === id)?.title ?? id;
  const parts = new Set();
  let linked = 0;
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new “${op.event.title}”`); break;
      case 'edit': parts.add(`${'start' in op.fields ? 'moved' : 'edited'} “${title(op.id)}”`); break;
      case 'link':
      case 'unremove': linked++; break;
      case 'checked': break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  if (linked) parts.add(`calendar synced (${linked})`);
  const text = [...parts].join(', ');
  return `events: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}
