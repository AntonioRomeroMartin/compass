// Dependency-free logic tests: `node --test tests/*.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodKey, periodKeys, daysUntil, civilDate, isValidTimeZone } from '../lib/period.js';
import { applyOps, categoryUsage, commitMessage, emptyDoc, isDone, isExpired, normalize, serialize, subgoalsDone } from '../lib/goals.js';
import { encodeBase64, decodeBase64 } from '../lib/github.js';

const UTC = 'UTC';
const BERLIN = 'Europe/Berlin'; // UTC+1 / UTC+2 en verano
const NY = 'America/New_York'; // UTC-5 / UTC-4 en verano

test('basic period keys', () => {
  assert.deepEqual(periodKeys('2026-09-28', UTC), {
    day: '2026-09-28', week: '2026-W40', month: '2026-09', quarter: '2026-Q3', year: '2026', deadline: 'once',
  });
});

test('ISO weeks at year boundaries', () => {
  assert.equal(periodKey('week', '2026-01-01', UTC), '2026-W01'); // jueves
  assert.equal(periodKey('week', '2027-01-01', UTC), '2026-W53'); // viernes: 2026 tiene 53 semanas
  assert.equal(periodKey('week', '2027-01-04', UTC), '2027-W01');
  assert.equal(periodKey('week', '2024-12-30', UTC), '2025-W01');
  assert.equal(periodKey('week', '2021-01-03', UTC), '2020-W53');
});

test('trimestres', () => {
  assert.equal(periodKey('quarter', '2026-03-31', UTC), '2026-Q1');
  assert.equal(periodKey('quarter', '2026-04-01', UTC), '2026-Q2');
  assert.equal(periodKey('quarter', '2026-12-31', UTC), '2026-Q4');
});

test('the given zone is used, not UTC or the system one', () => {
  const instant = new Date('2026-06-30T23:30:00Z');
  assert.deepEqual(civilDate(instant, BERLIN), { y: 2026, m: 7, d: 1 });
  assert.deepEqual(civilDate(instant, NY), { y: 2026, m: 6, d: 30 });
  assert.equal(periodKey('quarter', instant, BERLIN), '2026-Q3');
  assert.equal(periodKey('quarter', instant, NY), '2026-Q2');
  // Sunday 23:30 local is still in the same ISO week; Monday 00:30 is not.
  assert.equal(periodKey('week', new Date('2026-10-04T21:30:00Z'), BERLIN), '2026-W40');
  assert.equal(periodKey('week', new Date('2026-10-04T22:30:00Z'), BERLIN), '2026-W41');
  // New Year's Eve in New York when it is already the new year in UTC.
  assert.equal(periodKey('year', new Date('2027-01-01T03:00:00Z'), NY), '2026');
});

test('days until deadline', () => {
  assert.equal(daysUntil('2026-10-09', '2026-09-28', UTC), 11);
  assert.equal(daysUntil('2026-09-28', '2026-09-28', UTC), 0);
  assert.equal(daysUntil('2026-09-27', '2026-09-28', UTC), -1);
  // Crosses the October clock change without drifting.
  assert.equal(daysUntil('2026-11-01', new Date('2026-10-24T12:00:00Z'), BERLIN), 8);
});

test('time zone validation', () => {
  assert.ok(isValidTimeZone('Asia/Tokyo'));
  assert.ok(!isValidTimeZone('Marte/Olympus'));
  assert.ok(!isValidTimeZone(''));
  assert.ok(!isValidTimeZone(undefined));
});

const goal = (id, extra = {}) => ({
  id, kind: 'goal', title: `Objetivo ${id}`, category: 'Cat A', horizon: 'week', target: 4, unit: 'veces',
  deadline: null, period: '2026-W40', progress: 0, createdAt: '2026-09-28T00:00:00Z', repo: null, ...extra,
});

test('empty document without categories and with a time zone', () => {
  assert.deepEqual(emptyDoc('Asia/Tokyo'), { version: 1, timeZone: 'Asia/Tokyo', categories: [], goals: [] });
  assert.deepEqual(emptyDoc(), { version: 1, categories: [], goals: [] });
});

test('operations: progress, archive, delete, categories', () => {
  let doc = emptyDoc(UTC);
  doc = applyOps(doc, [
    { type: 'add', goal: goal('a') },
    { type: 'inc', id: 'a', delta: 1 },
    { type: 'inc', id: 'a', delta: 1 },
    { type: 'add', goal: goal('b', { category: 'Cat B' }) },
    { type: 'archive', id: 'b', archived: true },
  ]);
  assert.equal(doc.goals[0].progress, 2);
  assert.equal(doc.goals[1].archived, true);
  assert.deepEqual(doc.categories, ['Cat A', 'Cat B']);
  doc = applyOps(doc, [
    { type: 'inc', id: 'a', delta: -5 }, // does not go below 0
    { type: 'archive', id: 'b', archived: false },
    { type: 'delete', id: 'b' },
  ]);
  assert.equal(doc.goals[0].progress, 0);
  assert.equal(doc.goals.length, 1);
});

test('remove categories only if nobody uses them (archived included)', () => {
  let doc = applyOps(emptyDoc(UTC), [
    { type: 'addCategory', name: 'Empty' },
    { type: 'add', goal: goal('a', { archived: true }) },
  ]);
  assert.equal(categoryUsage(doc, 'Cat A'), 1);
  doc = applyOps(doc, [{ type: 'removeCategory', name: 'Cat A' }, { type: 'removeCategory', name: 'Empty' }]);
  assert.deepEqual(doc.categories, ['Cat A']);
});

test('cambiar zona horaria', () => {
  const doc = applyOps(emptyDoc(UTC), [{ type: 'setTimeZone', timeZone: NY }]);
  assert.equal(doc.timeZone, NY);
});

test('conflict: re-applying operations on the new version does not overwrite external changes', () => {
  const base = applyOps(emptyDoc(UTC), [{ type: 'add', goal: goal('a') }]);
  const pending = [{ type: 'inc', id: 'a', delta: 1 }];
  // Meanwhile, another client added a goal and progress on 'a'.
  const remote = applyOps(base, [
    { type: 'add', goal: goal('z', { title: 'Externo' }) },
    { type: 'set', id: 'a', value: 2 },
  ]);
  const merged = applyOps(remote, pending);
  assert.equal(merged.goals.find((g) => g.id === 'a').progress, 3);
  assert.ok(merged.goals.some((g) => g.id === 'z'));
  // If the goal was deleted elsewhere, the operation is ignored without error.
  const gone = applyOps({ ...remote, goals: remote.goals.filter((g) => g.id !== 'a') }, pending);
  assert.equal(gone.goals.length, 1);
});

test('commit message with prefix and grouping', () => {
  const before = applyOps(emptyDoc(UTC), [{ type: 'add', goal: goal('a', { title: 'Run' }) }]);
  const ops = [
    { type: 'inc', id: 'a', delta: 1 },
    { type: 'inc', id: 'a', delta: 1 },
    { type: 'inc', id: 'a', delta: 1 },
  ];
  assert.equal(commitMessage(ops, before, applyOps(before, ops)), 'goals: progress “Run”');
  const del = [{ type: 'delete', id: 'a' }];
  assert.equal(commitMessage(del, before, applyOps(before, del)), 'goals: deleted “Run”');
});

test('normalize y serialize', () => {
  const doc = normalize({ goals: [{ ...goal('a', { category: 'Nueva' }), progress: undefined }] });
  assert.equal(doc.goals[0].progress, 0);
  assert.deepEqual(doc.categories, ['Nueva']);
  assert.equal(normalize({ timeZone: NY, goals: [] }).timeZone, NY);
  assert.ok(serialize(emptyDoc()).endsWith('}\n'));
});

test('base64 with accents and emojis', () => {
  const s = '{"title":"Read «Café Society» 📚"}';
  assert.equal(decodeBase64(encodeBase64(s)), s);
  assert.equal(encodeBase64('ñ'), Buffer.from('ñ').toString('base64'));
});

test('a goal stays in its period and expires when it ends', () => {
  const g = goal('o', { progress: 2 });
  const sunday = new Date('2026-10-04T23:00:00Z');
  const monday = new Date('2026-10-05T00:30:00Z');
  assert.ok(!isExpired(g, sunday, UTC));
  assert.ok(isExpired(g, monday, UTC));
  assert.ok(!isDone(g)); // 2 / 4: not met
  assert.ok(isDone({ ...g, target: null, progress: 1 }));
});

test('deadline: expires the day after the date', () => {
  const g = goal('d', { horizon: 'deadline', deadline: '2026-10-09', period: null, target: null });
  assert.ok(!isExpired(g, new Date('2026-10-09T23:59:00Z'), UTC));
  assert.ok(isExpired(g, new Date('2026-10-10T00:01:00Z'), UTC));
});

test('compatibility: the old format, with repeating goals and progress per period', () => {
  const sub = (done) => ({ id: 's1', title: 'Step', done });
  const doc = normalize({ timeZone: UTC, goals: [
    goal('a', { repeat: true, period: undefined, progress: { '2026-W40': 3, '2026-W41': 1 }, subgoals: [sub(['2026-W41'])] }),
    goal('b', { repeat: false, period: '2026-W41', progress: { '2026-W41': 2 }, subgoals: [sub(['2026-W41'])] }),
    goal('c', { horizon: 'deadline', repeat: true, progress: { once: 5 } }),
  ] });
  // A repeating goal belongs to the period in which it was created, and only that period's values count.
  assert.deepEqual(doc.goals.map((g) => [g.period, g.progress, g.subgoals?.[0].done, 'repeat' in g]),
    [['2026-W40', 3, false, false], ['2026-W41', 2, true, false], [null, 5, undefined, false]]);
  assert.ok(isExpired(doc.goals[0], new Date('2026-10-05T12:00:00Z'), UTC));
});

test('location and notes: saved, edited and removed', () => {
  let doc = applyOps(emptyDoc(UTC), [{ type: 'add', goal: goal('g1', { location: 'Library', notes: 'Line 1\nLine 2' }) }]);
  assert.equal(doc.goals[0].location, 'Library');
  assert.equal(doc.goals[0].notes, 'Line 1\nLine 2');
  doc = applyOps(doc, [{ type: 'edit', id: 'g1', fields: { location: null, notes: 'Otra' } }]);
  assert.equal(doc.goals[0].location, null);
  assert.equal(doc.goals[0].notes, 'Otra');
  assert.equal(normalize(JSON.parse(serialize(doc))).goals[0].notes, 'Otra');
});

test('sub-goals: add, tick, rename and remove', () => {
  const sub = (id, title) => ({ id, title, done: false });
  let doc = applyOps(emptyDoc(UTC), [{ type: 'add', goal: goal('g1', { subgoals: [sub('s1', 'Paso 1')] }) }]);
  doc = applyOps(doc, [
    { type: 'addSub', id: 'g1', sub: sub('s2', 'Paso 2') },
    { type: 'addSub', id: 'g1', sub: sub('s2', 'Duplicate') }, // same id: ignored
    { type: 'toggleSub', id: 'g1', subId: 's1', done: true },
    { type: 'toggleSub', id: 'g1', subId: 's1', done: true }, // idempotente
    { type: 'editSub', id: 'g1', subId: 's2', title: 'Paso dos' },
    { type: 'toggleSub', id: 'nope', subId: 's1', done: true }, // objetivo inexistente
  ]);
  const g = doc.goals[0];
  assert.deepEqual(g.subgoals?.map((s) => s.title), ['Paso 1', 'Paso dos']);
  assert.equal(subgoalsDone(g), 1);
  doc = applyOps(doc, [{ type: 'toggleSub', id: 'g1', subId: 's1', done: false }]);
  assert.equal(subgoalsDone(doc.goals[0]), 0);
  doc = applyOps(doc, [{ type: 'removeSub', id: 'g1', subId: 's1' }, { type: 'removeSub', id: 'g1', subId: 's2' }]);
  assert.equal(doc.goals[0].subgoals, undefined); // without sub-goals the field is not left behind
  assert.match(commitMessage([{ type: 'removeSub', id: 'g1', subId: 's1' }], doc, doc), /sub-goals “Objetivo g1”/);
});

test('sub-goals: normalize tolerates odd data', () => {
  const doc = normalize({ goals: [
    goal('a', { subgoals: [{ id: 's1', title: 'Ok', done: 'yes' }, { title: 'no id' }, null] }),
    goal('b', { subgoals: 'x' }),
    goal('c'),
  ] });
  assert.deepEqual(doc.goals[0].subgoals, [{ id: 's1', title: 'Ok', done: false }]);
  assert.equal(doc.goals[1].subgoals, undefined);
  assert.ok(!('subgoals' in doc.goals[2]));
});
