// @ts-check
// Keeping a calendar copy of the events (events.json is where they are kept; the calendar only shows them).
//
// A domain says which calendar its events go to (`calendar`, a calendar id, inherited by its sub-domains) and with
// which color (`calendarColor`, also inherited). compass does not talk to the calendar itself: whoever syncs (an
// agent with a calendar connector, a script) asks for a plan, carries it out and reports back what it did:
//
//   1. `window(events, domains)`: the calendars and days to read.
//   2. `plan(events, domains, remote)`: with what the calendar has now (`remote`, by calendar id), what changed on
//      each side since the last sync. Changed only in compass → push it; changed only in the calendar (title, times
//      or place) → pull it into compass; changed on both, or deleted in the calendar → a conflict, for the user.
//   3. After pushing, `link` each event with the id its copy has, which records both sides as equal.
//
// The calendar copy's title is "<domain name> · <title>"; its description is the event's notes.

import { addDays } from './period.js';
import * as domains from './domains.js';
import { FIELDS, dayOf, fieldsOf, isAllDay, isWhen, lastDay, sameFields } from './events.js';

/** @typedef {import('./events.js').Event} Event */
/** @typedef {import('./events.js').EventsDoc} EventsDoc */
/** @typedef {import('./events.js').Fields} Fields */
/** @typedef {import('./domains.js').DomainsDoc} DomainsDoc */

/** Fields a change made in the calendar is taken from (the description is written only by compass). */
export const PULLED = /** @type {const} */ (['title', 'start', 'end', 'location']);

/**
 * What a calendar connector creates or updates: local times without offset, in the data's zone.
 * @typedef {Object} CalendarData
 * @property {string} summary
 * @property {string} startTime   "YYYY-MM-DDTHH:MM:00"
 * @property {string} endTime     all day: the day after the last one, at 00:00
 * @property {boolean} allDay
 * @property {string} location
 * @property {string} description
 * @property {string} [colorId]
 */

/**
 * @typedef {{ action: 'create', event: string, calendar: string, data: CalendarData }
 *   | { action: 'update', event: string, calendar: string, calId: string, data: CalendarData }
 *   | { action: 'delete', event: string|null, calendar: string, calId: string }} Push
 */

/**
 * @typedef {Object} Plan
 * @property {{ event: string, title: string, fields: Fields }[]} pull   changes made in the calendar, to apply
 * @property {Push[]} push
 * @property {{ event: string, title: string, compass: Fields, calendar: Fields|null }[]} conflicts
 *           changed on both sides, or (calendar null) deleted in the calendar
 */

/**
 * The calendar (and color) of a domain's events: its own, or the nearest parent's. Null: not synced.
 * @param {DomainsDoc} doc @param {string} domain
 * @returns {{ calendar: string, color: string|null }|null}
 */
export function target(doc, domain) {
  const id = domains.canonical(doc, domain);
  if (!id) return null;
  const chain = [id, ...domains.ancestors(doc, id)].map((x) => /** @type {any} */ (domains.find(doc, x))).filter(Boolean);
  const calendar = chain.find((d) => typeof d.calendar === 'string' && d.calendar)?.calendar;
  if (!calendar) return null;
  const color = chain.find((d) => typeof d.calendarColor === 'string' && d.calendarColor)?.calendarColor ?? null;
  return { calendar, color };
}

/** "<domain name> · " for the calendar titles. @param {DomainsDoc} doc @param {string} domain */
export function prefix(doc, domain) {
  const d = domains.find(doc, domains.canonical(doc, domain) || domain);
  return `${d?.name ?? domain} · `;
}

/** A time plus some minutes (across midnight too). @param {string} when "YYYY-MM-DDTHH:MM" @param {number} n */
export function addMinutes(when, n) {
  const total = Number(when.slice(11, 13)) * 60 + Number(when.slice(14, 16)) + n;
  const days = Math.floor(total / 1440);
  const min = total - days * 1440;
  return `${addDays(dayOf(when), days)}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** The end an event has in a calendar: its own, or one hour (timed) or the same day (all day). @param {Fields} f */
export const endOf = (f) => f.end ?? (isAllDay(f.start) ? f.start : addMinutes(f.start, 60));

/** The fields as a calendar keeps them (a missing end filled in), to compare. @param {Fields} f @returns {Fields} */
const canon = (f) => ({ ...f, end: endOf(f) });

/**
 * The calendar copy of an event.
 * @param {Event} e @param {DomainsDoc} doms @param {string|null} color
 * @returns {CalendarData}
 */
export function toCalendar(e, doms, color) {
  const allDay = isAllDay(e.start);
  return {
    summary: prefix(doms, e.domain) + e.title,
    startTime: allDay ? `${e.start}T00:00:00` : `${e.start}:00`,
    endTime: allDay ? `${addDays(lastDay(e), 1)}T00:00:00` : `${endOf(e)}:00`,
    allDay,
    location: e.location ?? '',
    description: e.notes ?? '',
    ...(color ? { colorId: color } : {}),
  };
}

/**
 * A civil time ("YYYY-MM-DDTHH:MM") from a calendar's date-time: with an offset or "Z", converted to `tz`; without
 * one, taken as it is.
 * @param {string} s @param {string} tz
 */
export function civilTime(s, tz) {
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) return s.slice(0, 16);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(s)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * An event as a calendar returns it (Google's shape: `summary`, `start.dateTime` or `start.date`, …), as fields.
 * Null if it was cancelled or cannot be read.
 * @param {any} raw @param {string} tz @param {string} [titlePrefix]  taken off the title
 * @returns {Fields|null}
 */
export function fromCalendar(raw, tz, titlePrefix = '') {
  if (!raw || raw.status === 'cancelled') return null;
  /** @param {any} t @param {boolean} isEnd */
  const when = (t, isEnd) => {
    if (typeof t === 'string') return t.length > 10 ? civilTime(t, tz) : t;
    if (typeof t?.dateTime === 'string') return civilTime(t.dateTime, tz);
    // An all-day event's end is the day after its last one.
    if (typeof t?.date === 'string') return isEnd ? addDays(t.date.slice(0, 10), -1) : t.date.slice(0, 10);
    return null;
  };
  const start = when(raw.start, false);
  let end = when(raw.end, true);
  if (!isWhen(start)) return null;
  if (!isWhen(end) || isAllDay(start) !== isAllDay(end) || end < start) end = null;
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  /** @type {Fields} */
  const f = {
    title: titlePrefix && summary.startsWith(titlePrefix) ? summary.slice(titlePrefix.length) : summary,
    start, end, location: typeof raw.location === 'string' && raw.location.trim() ? raw.location : null,
    notes: typeof raw.description === 'string' && raw.description.trim() ? raw.description : null,
  };
  // The default end is not kept, so an untouched copy matches its event.
  if (f.end === endOf({ ...f, end: null })) f.end = null;
  return f;
}

/**
 * The calendars to read and the days to read them, for `plan`: every calendar in use, from the first linked event to
 * the last (and today, for those with none yet).
 * @param {EventsDoc} doc @param {DomainsDoc} doms @param {string} today
 * @returns {{ calendar: string, from: string, to: string }[]}
 */
export function window(doc, doms, today) {
  /** @type {Map<string, { calendar: string, from: string, to: string }>} */
  const out = new Map();
  /** @param {string} calendar @param {string} from @param {string} to */
  const add = (calendar, from, to) => {
    const w = out.get(calendar);
    if (!w) out.set(calendar, { calendar, from, to });
    else {
      if (from < w.from) w.from = from;
      if (to > w.to) w.to = to;
    }
  };
  for (const e of doc.events) {
    if (e.cal) add(e.cal.calendar, dayOf(e.cal.last.start), addDays(lastDay(e.cal.last), 1));
    const t = target(doms, e.domain);
    if (t && !e.cal) add(t.calendar, today, addDays(today, 1));
  }
  return [...out.values()];
}

/**
 * What a sync has to do.
 * @param {EventsDoc} doc @param {DomainsDoc} doms
 * @param {Record<string, any[]>|null} [remote]  what each calendar has now (its events, as the calendar returns them),
 *   by calendar id; a calendar left out was not read: only compass's changes are pushed to it
 * @returns {Plan}
 */
export function plan(doc, doms, remote = null) {
  const tz = doc.timeZone ?? 'UTC';
  /** @type {Plan} */
  const out = { pull: [], push: [], conflicts: [] };
  for (const e of doc.events) {
    const t = target(doms, e.domain);
    const local = fieldsOf(e);
    if (e.cal && (!t || t.calendar !== e.cal.calendar)) {
      // Its domain no longer goes to that calendar: the old copy goes, and a new one is made where it belongs.
      out.push.push({ action: 'delete', event: e.id, calendar: e.cal.calendar, calId: e.cal.id });
      if (t) out.push.push({ action: 'create', event: e.id, calendar: t.calendar, data: toCalendar(e, doms, t.color) });
      continue;
    }
    if (!t) continue;
    if (!e.cal) {
      out.push.push({ action: 'create', event: e.id, calendar: t.calendar, data: toCalendar(e, doms, t.color) });
      continue;
    }
    const { id: calId, last } = e.cal;
    const changedHere = !sameFields(canon(local), canon(last), FIELDS);
    const list = remote?.[e.cal.calendar];
    /** @type {Fields|null|undefined} undefined: not read */
    let there;
    if (list) {
      const raw = list.find((x) => x?.id === calId);
      there = raw ? fromCalendar(raw, tz, prefix(doms, e.domain)) : null;
    }
    if (there === null) {
      out.conflicts.push({ event: e.id, title: e.title, compass: local, calendar: null });
      continue;
    }
    const changedThere = !!there && !sameFields(canon(there), canon(last), PULLED);
    if (changedHere && changedThere) out.conflicts.push({ event: e.id, title: e.title, compass: local, calendar: /** @type {Fields} */ (there) });
    else if (changedThere && there) {
      out.pull.push({ event: e.id, title: e.title, fields: { ...local, title: there.title, start: there.start, end: there.end, location: there.location } });
    } else if (changedHere) {
      out.push.push({ action: 'update', event: e.id, calendar: e.cal.calendar, calId, data: toCalendar(e, doms, t.color) });
    }
  }
  for (const r of doc.removed) out.push.push({ action: 'delete', event: null, calendar: r.calendar, calId: r.id });
  return out;
}

/**
 * The link an event gets once its copy is in the calendar as it is now in compass.
 * @param {Event} e @param {string} calId @param {string} calendar
 * @returns {import('./events.js').Link}
 */
export const linkFor = (e, calId, calendar) => ({ id: calId, calendar, last: fieldsOf(e) });
