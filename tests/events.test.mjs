// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../lib/events.js';
import * as calendar from '../lib/calendar.js';
import { buildToday } from '../lib/today.js';
import { normalize as normalizeDomains } from '../lib/domains.js';

const DOMAINS = normalizeDomains({
  version: 1,
  domains: [
    { id: 'studies', name: 'Studies', calendar: 'cal-studies' },
    { id: 'studies/course-a', name: 'Course A', calendarColor: '9' },
    { id: 'home', name: 'Home' },
  ],
});

/** @param {Partial<events.Event>} [over] */
const exam = (over = {}) => events.newEvent({ title: 'Exam', domain: 'studies/course-a', start: '2027-01-12T10:30', end: '2027-01-12T12:30', location: 'Room 1', ...over }, new Date('2026-11-01T00:00:00Z'));

test('events: parseWhen, whenText, moveTo, upcoming', () => {
  assert.deepEqual(events.parseWhen('2026-12-11'), { start: '2026-12-11', end: null });
  assert.deepEqual(events.parseWhen('2027-01-04', null, '2027-01-07'), { start: '2027-01-04', end: '2027-01-07' });
  assert.deepEqual(events.parseWhen('2026-11-04', '14:30-16:00'), { start: '2026-11-04T14:30', end: '2026-11-04T16:00' });
  assert.deepEqual(events.parseWhen('2026-11-13', '23:05-00:05', '2026-11-14'), { start: '2026-11-13T23:05', end: '2026-11-14T00:05' });
  assert.throws(() => events.parseWhen('2026-11-04', '16:00-14:00'), /after it starts/);
  assert.throws(() => events.parseWhen('2026-11-04', '25:00'), /invalid time/);
  assert.equal(events.whenText(exam()), 'Tue 12 Jan 10:30–12:30');
  assert.equal(events.whenText(events.newEvent({ title: 'x', domain: 'd', start: '2027-01-04', end: '2027-01-07' })), 'Mon 4 Jan – Thu 7 Jan');
  assert.deepEqual(events.moveTo(exam(), '2027-01-14'), { start: '2027-01-14T10:30', end: '2027-01-14T12:30' });
  const doc = { ...events.emptyDoc('UTC'), events: [exam(), exam({ title: 'Old', start: '2026-10-01', end: null })] };
  assert.deepEqual(events.upcoming(doc, '2026-11-03').map((e) => e.title), ['Exam']);
  assert.deepEqual(events.upcoming(doc, '2026-11-03', 7), []);
  assert.deepEqual(events.upcoming(doc, '2027-01-10', 7).map((e) => e.title), ['Exam']);
});

test('events: normalize, ops and the removed calendar copies', () => {
  const doc = events.normalize({ events: [{ id: 'e_1', title: 'A', domain: 'x', start: 'bad' }, { id: 'e_2', title: 'B', domain: 'x', start: '2026-12-01', cal: { id: 'c1' } }] });
  assert.deepEqual(doc.events.map((e) => [e.id, e.cal]), [['e_2', null]]);
  const e = exam();
  let d = events.applyOps(events.emptyDoc('UTC'), [{ type: 'add', event: e }, { type: 'link', id: e.id, cal: calendar.linkFor(e, 'c9', 'cal-studies') }]);
  d = events.applyOps(d, [{ type: 'delete', id: e.id }]);
  assert.deepEqual([d.events, d.removed], [[], [{ id: 'c9', calendar: 'cal-studies' }]]);
  assert.deepEqual(events.applyOps(d, [{ type: 'unremove', calId: 'c9' }]).removed, []);
  assert.equal(events.commitMessage([{ type: 'edit', id: e.id, fields: { start: '2027-01-13' } }], { ...d, events: [e] }, { ...d, events: [e] }), 'events: moved “Exam”');
});

test('calendar: target and copy of an event', () => {
  assert.deepEqual(calendar.target(DOMAINS, 'studies/course-a'), { calendar: 'cal-studies', color: '9' });
  assert.equal(calendar.target(DOMAINS, 'home'), null);
  assert.deepEqual(calendar.toCalendar(exam(), DOMAINS, '9'), {
    summary: 'Course A · Exam', startTime: '2027-01-12T10:30:00', endTime: '2027-01-12T12:30:00', allDay: false,
    location: 'Room 1', description: '', colorId: '9',
  });
  const allDay = calendar.toCalendar(events.newEvent({ title: 'Talk', domain: 'studies', start: '2027-01-04', end: '2027-01-07' }), DOMAINS, null);
  assert.deepEqual([allDay.startTime, allDay.endTime, allDay.allDay], ['2027-01-04T00:00:00', '2027-01-08T00:00:00', true]);
  assert.equal(calendar.addMinutes('2026-11-13T23:30', 60), '2026-11-14T00:30');
  // Google's shapes: a date-time in UTC (Lisbon in summer is UTC+1) and an all-day event, whose end is the next day.
  assert.equal(calendar.civilTime('2026-07-01T09:00:00Z', 'Europe/Lisbon'), '2026-07-01T10:00');
  assert.equal(calendar.civilTime('2026-07-01T09:00:00', 'Europe/Lisbon'), '2026-07-01T09:00');
  assert.deepEqual(calendar.fromCalendar({ summary: 'Course A · Talk', start: { date: '2026-12-16' }, end: { date: '2026-12-17' } }, 'UTC', 'Course A · '),
    { title: 'Talk', start: '2026-12-16', end: null, location: null, notes: null });
  assert.equal(calendar.fromCalendar({ status: 'cancelled', start: { date: '2026-12-16' } }, 'UTC'), null);
});

test('calendar: plan pushes, pulls and reports conflicts', () => {
  const synced = exam({ id: 'e_s' });
  synced.cal = calendar.linkFor(synced, 'c1', 'cal-studies');
  const fresh = exam({ id: 'e_new', title: 'Quiz' });
  const homeOnly = events.newEvent({ id: 'e_h', title: 'Dentist', domain: 'home', start: '2026-12-01T09:00' });
  const doc = { ...events.emptyDoc('UTC'), events: [synced, fresh, homeOnly], removed: [{ id: 'c0', calendar: 'cal-studies' }] };

  // Without reading the calendar: only compass's side.
  let p = calendar.plan(doc, DOMAINS);
  assert.deepEqual(p.push.map((x) => [x.action, x.event]), [['create', 'e_new'], ['delete', null]]);

  // The calendar copy as it was pushed: nothing to do for it.
  const copy = { id: 'c1', summary: 'Course A · Exam', start: { dateTime: '2027-01-12T10:30:00Z' }, end: { dateTime: '2027-01-12T12:30:00Z' }, location: 'Room 1' };
  p = calendar.plan(doc, DOMAINS, { 'cal-studies': [copy] });
  assert.deepEqual([p.pull, p.conflicts], [[], []]);

  // Moved in the calendar → pulled.
  const moved = { ...copy, start: { dateTime: '2027-01-14T15:30:00Z' }, end: { dateTime: '2027-01-14T17:30:00Z' }, location: 'Room 2' };
  p = calendar.plan(doc, DOMAINS, { 'cal-studies': [moved] });
  assert.deepEqual(p.pull.map((x) => [x.event, x.fields.start, x.fields.end, x.fields.location]), [['e_s', '2027-01-14T15:30', '2027-01-14T17:30', 'Room 2']]);

  // Changed in compass too → a conflict; changed only in compass → an update.
  const edited = { ...doc, events: [{ ...synced, location: 'Room 3' }] };
  p = calendar.plan(edited, DOMAINS, { 'cal-studies': [moved] });
  assert.deepEqual([p.pull.length, p.conflicts.map((x) => x.event)], [0, ['e_s']]);
  p = calendar.plan(edited, DOMAINS, { 'cal-studies': [copy] });
  assert.deepEqual(p.push.map((x) => [x.action, x.event]), [['update', 'e_s'], ['delete', null]]);

  // Deleted in the calendar → a conflict (the user decides).
  p = calendar.plan(doc, DOMAINS, { 'cal-studies': [] });
  assert.deepEqual(p.conflicts.map((x) => [x.event, x.calendar]), [['e_s', null]]);

  // Its domain moved to one without a calendar → the copy is deleted.
  p = calendar.plan({ ...doc, events: [{ ...synced, domain: 'home' }], removed: [] }, DOMAINS);
  assert.deepEqual(p.push.map((x) => [x.action, x.event]), [['delete', 'e_s']]);

  assert.deepEqual(calendar.window(doc, DOMAINS, '2026-11-03'), [{ calendar: 'cal-studies', from: '2026-11-03', to: '2027-01-13' }]);
});

test('today: events in the next 7 days, in their domain', () => {
  const doc = { ...events.emptyDoc('UTC'), events: [exam()] };
  const view = buildToday({
    goals: { version: 1, timeZone: 'UTC', goals: [] }, tasks: { version: 1, timeZone: 'UTC', tasks: [] }, domains: DOMAINS,
    events: doc, now: new Date('2027-01-08T12:00:00Z'), tz: 'UTC',
  });
  assert.deepEqual(view.groups.map((g) => [g.domain, g.events.map((e) => e.title)]), [['studies/course-a', ['Exam']]]);
});
