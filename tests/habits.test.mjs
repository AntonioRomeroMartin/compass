// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as habits from '../lib/habits.js';

const MON = '2026-10-26';
const habit = (/** @type {string} */ id, /** @type {any} */ extra = {}) =>
  habits.newHabit({ id, title: `Habit ${id}`, domain: 'sport', freq: { type: 'daily' }, ...extra }, new Date('2026-10-01T10:00:00Z'));

test('frequencies as typed, and their short text', () => {
  assert.deepEqual(habits.parseFreq('daily'), { type: 'daily' });
  assert.deepEqual(habits.parseFreq('3/week'), { type: 'weekly', times: 3 });
  assert.deepEqual(habits.parseFreq('2x'), { type: 'weekly', times: 2 });
  assert.deepEqual(habits.parseFreq('4 times a week'), { type: 'weekly', times: 4 });
  assert.deepEqual(habits.parseFreq('7/week'), { type: 'daily' });
  assert.deepEqual(habits.parseFreq('thu, mon'), { type: 'days', days: [1, 4] });
  assert.throws(() => habits.parseFreq('sometimes'), /unknown frequency/);
  assert.throws(() => habits.parseFreq('9/week'), /unknown frequency/);
  assert.deepEqual(['daily', '3/week', 'mon,thu'].map((s) => habits.freqText(habits.parseFreq(s))), ['daily', '3/week', 'mon,thu']);
});

test('normalize tolerates odd data and keeps done days unique and sorted', () => {
  const doc = habits.normalize({ habits: [
    { id: 'a', title: 'Read', domain: 'books', freq: { type: 'daily' }, done: ['2026-10-02', 'x', '2026-10-01', '2026-10-02'], archived: 'yes' },
    { id: 'b', title: 'No frequency', freq: { type: 'hourly' } },
    { title: 'No id', freq: { type: 'daily' } },
    { id: 'c', title: 'Days', freq: { type: 'days', days: [4, 1, 9, 1] } },
  ] });
  assert.deepEqual(doc.habits.map((h) => h.id), ['a', 'c']);
  assert.deepEqual(doc.habits[0].done, ['2026-10-01', '2026-10-02']);
  assert.ok(!('archived' in doc.habits[0]));
  assert.deepEqual(doc.habits[1].freq, { type: 'days', days: [1, 4] });
  assert.equal(doc.habits[1].notes, null);
});

test('this week: daily of 7, N a week of N, given weekdays of those days', () => {
  const week = ['2026-10-26', '2026-10-27', '2026-10-29', '2026-11-01'];
  const prev = '2026-10-25'; // Sunday of the week before: never counts
  assert.deepEqual(habits.weekProgress(habit('d', { done: [prev, ...week] }), MON), { done: 4, of: 7 });
  assert.deepEqual(habits.weekProgress(habit('w', { freq: { type: 'weekly', times: 3 }, done: week }), '2026-10-30'), { done: 4, of: 3 });
  // Mon and Thu: Tuesday and Sunday do not count.
  assert.deepEqual(habits.weekProgress(habit('k', { freq: { type: 'days', days: [1, 4] }, done: week }), MON), { done: 2, of: 2 });
  assert.deepEqual(habits.weekOf('2026-11-01'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
});

test('which day lists a habit', () => {
  const days = habit('k', { freq: { type: 'days', days: [1, 4] } });
  assert.ok(habits.isDueOn(days, MON));
  assert.ok(!habits.isDueOn(days, '2026-10-27'));
  const twice = habit('w', { freq: { type: 'weekly', times: 2 }, done: ['2026-10-26', '2026-10-28'] });
  assert.ok(habits.isDueOn(twice, '2026-10-28')); // done that day: stays, ticked
  assert.ok(!habits.isDueOn(twice, '2026-10-29')); // the week already has 2
  assert.ok(habits.isDueOn(twice, '2026-11-02')); // a new week
  assert.ok(!habits.isDueOn(habit('a', { archived: true }), MON));
});

test('operations: add, mark any day, edit, archive, delete, and the commit message', () => {
  let doc = habits.applyOps(habits.emptyDoc('UTC'), [
    { type: 'add', habit: habit('a', { title: 'Read' }) },
    { type: 'mark', id: 'a', date: '2026-10-20', done: true },
    { type: 'mark', id: 'a', date: '2026-10-02', done: true },
    { type: 'mark', id: 'a', date: '2026-10-20', done: true }, // twice: once
    { type: 'mark', id: 'a', date: 'yesterday', done: true }, // not a date: ignored
    { type: 'mark', id: 'nope', date: '2026-10-20', done: true }, // gone: ignored
  ]);
  assert.deepEqual(doc.habits[0].done, ['2026-10-02', '2026-10-20']);
  const ops = /** @type {habits.Op[]} */ ([
    { type: 'mark', id: 'a', date: '2026-10-02', done: false },
    { type: 'edit', id: 'a', fields: { freq: { type: 'weekly', times: 3 } } },
    { type: 'archive', id: 'a', archived: true },
  ]);
  const after = habits.applyOps(doc, ops);
  assert.deepEqual([after.habits[0].done, after.habits[0].freq, after.habits[0].archived], [['2026-10-20'], { type: 'weekly', times: 3 }, true]);
  assert.equal(habits.commitMessage(ops, doc, after), 'habits: undone “Read” 2026-10-02, edited “Read”, archived “Read”');
  doc = habits.applyOps(after, [{ type: 'delete', id: 'a' }]);
  assert.equal(doc.habits.length, 0);
  assert.equal(habits.normalize(JSON.parse(habits.serialize(after))).habits[0].archived, true);
});
