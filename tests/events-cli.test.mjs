// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };
const TASKS = { version: 1, timeZone: 'UTC', tasks: [] };
const DOMAINS = { version: 1, domains: [{ id: 'studies', name: 'Studies' }, { id: 'studies/course-a', name: 'Course A' }] };

test('events: add, move with its tasks, list, delete', () => {
  const { dir, run, runAll, read } = setup({ 'goals.json': GOALS, 'tasks.json': TASKS, 'domains.json': DOMAINS });
  assert.match(run('event', 'add', 'Exam', '--domain', 'course-a', '--date', '2099-01-12', '--time', '10:30-12:30', '--location', 'Room 1'),
    /^events: new “Exam”\n◷ \[e_\w+\] Exam — Mon 12 Jan 10:30–12:30 \(in \d+ d\) · studies\/course-a · @ Room 1\n$/);
  const [e] = read('a', 'events.json').events;
  assert.deepEqual([e.start, e.end, e.cal], ['2099-01-12T10:30', '2099-01-12T12:30', null]);
  run('task', 'add', 'Study for the exam', '--domain', 'course-a', '--due', '2099-01-05', '--event', 'exam');
  assert.equal(read('a', 'tasks.json').tasks[0].event, e.id);
  // Moving the event moves its open task by the same days, in one commit.
  run('event', 'edit', 'exam', '--date', '2099-01-14');
  assert.deepEqual([read('a', 'events.json').events[0].start, read('a', 'tasks.json').tasks[0].due], ['2099-01-14T10:30', '2099-01-07']);
  assert.match(git(join(dir, 'a'), 'log', '-1', '--format=%B'), /events: moved “Exam”\n\ntasks: moved “Study for the exam”/);
  // A new time keeps the day; none makes it all day.
  run('event', 'edit', 'exam', '--time', '15:30-17:30');
  assert.equal(read('a', 'events.json').events[0].end, '2099-01-14T17:30');
  run('event', 'edit', 'exam', '--time', 'none');
  assert.deepEqual([read('a', 'events.json').events[0].start, read('a', 'events.json').events[0].end], ['2099-01-14', null]);
  assert.match(run('events', '--domain', 'studies'), /Exam/);
  assert.match(run('event', 'show', 'exam'), /Study for the exam/);
  assert.match(runAll('event', 'delete', 'exam').stderr, /--yes/);
  run('event', 'delete', 'exam', '--yes');
  assert.deepEqual([read('a', 'events.json').events, read('a', 'tasks.json').tasks[0].event], [[], undefined]);
});

test('calendar: domains with a calendar, sync plan, done, pull and window', () => {
  const { dir, run, runInput, read } = setup({ 'goals.json': GOALS, 'tasks.json': TASKS, 'domains.json': DOMAINS });
  run('domain', 'edit', 'studies', '--calendar', 'cal-1');
  run('domain', 'edit', 'studies/course-a', '--calendar-color', '9');
  assert.deepEqual(read('a', 'domains.json').domains.map((/** @type {any} */ d) => [d.calendar, d.calendarColor]), [['cal-1', undefined], [undefined, '9']]);
  // One already in the calendar (adopted as it is), one new.
  run('event', 'add', 'Quiz', '--domain', 'course-a', '--date', '2099-01-05', '--time', '14:30-15:30', '--cal-id', 'g-quiz');
  run('event', 'add', 'Project', '--domain', 'course-a', '--date', '2099-01-20');
  assert.match(run('calendar'), /1 to sync \(1 create\)/);
  assert.match(run('today'), /Calendar: 1 to sync \(1 create\)/);
  const plan = JSON.parse(run('calendar', 'sync'));
  assert.deepEqual(plan.push.map((/** @type {any} */ p) => [p.action, p.data.summary, p.data.allDay, p.data.colorId]), [['create', 'Course A · Project', true, '9']]);
  const project = read('a', 'events.json').events.find((/** @type {any} */ x) => x.title === 'Project');
  assert.match(runInput(JSON.stringify([{ event: project.id, calId: 'g-proj' }]), 'calendar', 'done').stdout, /Calendar: in sync\./);
  // The quiz was moved in the calendar: the sync pulls it.
  const remote = { 'cal-1': [
    { id: 'g-quiz', summary: 'Course A · Quiz', start: { dateTime: '2099-01-06T14:30:00Z' }, end: { dateTime: '2099-01-06T15:30:00Z' } },
    { id: 'g-proj', summary: 'Course A · Project', start: { date: '2099-01-20' }, end: { date: '2099-01-21' } },
  ] };
  const file = join(dir, 'remote.json');
  writeFileSync(file, JSON.stringify(remote));
  const synced = JSON.parse(run('calendar', 'sync', '--remote', file));
  assert.deepEqual([synced.pulled.map((/** @type {any} */ p) => p.title), synced.push, synced.conflicts], [['Quiz'], [], []]);
  const quiz = read('a', 'events.json').events.find((/** @type {any} */ x) => x.title === 'Quiz');
  assert.deepEqual([quiz.start, quiz.cal.last.start], ['2099-01-06T14:30', '2099-01-06T14:30']);
  assert.ok(read('a', 'events.json').checkedAt);
  assert.deepEqual(JSON.parse(run('calendar', 'window')), [{ calendar: 'cal-1', from: '2099-01-06', to: '2099-01-21' }]);
  // Deleting one leaves its copy to delete; done with {deleted} clears it.
  run('event', 'delete', 'project', '--yes');
  assert.deepEqual(JSON.parse(run('calendar', 'sync')).push.map((/** @type {any} */ p) => [p.action, p.calId]), [['delete', 'g-proj']]);
  runInput(JSON.stringify([{ deleted: 'g-proj' }]), 'calendar', 'done');
  assert.deepEqual(read('a', 'events.json').removed, []);
});
