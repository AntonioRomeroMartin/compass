// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };
const DOMAINS = { version: 1, domains: [{ id: 'fitness', name: 'Fitness' }, { id: 'fitness/gym', name: 'Gym', parent: 'fitness' }, { id: 'books', name: 'Books' }] };

test('habits: add, mark today and past days, list, edit, archive and delete', () => {
  const { dir, run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  assert.match(run('habit', 'add', 'Gym', '--domain', 'gym', '--freq', '3/week'), /^habits: new “Gym”\n· \[h_\w+\] Gym — 3\/week · 0\/3 this week · fitness\/gym\n$/);
  run('habit', 'add', 'Read', '--domain', 'books', '--freq', 'daily');
  // habits.json is created with the zone of the other files, in its own commit.
  const doc = read('a', 'habits.json');
  assert.equal(doc.timeZone, 'UTC');
  assert.equal(git(join(dir, 'a'), 'log', '-1', '--format=%s'), 'habits: new “Read”\n');
  assert.match(run('habit', 'done', 'gym'), /^habits: done “Gym” \d{4}-\d{2}-\d{2}\n✓ \[h_\w+\] Gym — 3\/week · 1\/3 this week/);
  assert.match(run('habit', 'done', 'gym'), /^No change\./);
  run('habit', 'done', 'gym', 'yesterday');
  run('habit', 'done', 'gym', '-3');
  assert.equal(read('a', 'habits.json').habits[0].done.length, 3);
  run('habit', 'undo', 'gym', 'yesterday');
  assert.equal(read('a', 'habits.json').habits[0].done.length, 2);
  // Several days in one commit (as a sync script does), already marked ones left as they are.
  const before = git(join(dir, 'a'), 'rev-list', '--count', 'HEAD');
  assert.match(run('habit', 'done', 'gym', '-3', '-5', '-6'), /^habits: done “Gym” \d{4}-\d{2}-\d{2}, \d{4}-\d{2}-\d{2}, \d{4}-\d{2}-\d{2}\n/);
  assert.equal(Number(git(join(dir, 'a'), 'rev-list', '--count', 'HEAD')), Number(before) + 1);
  assert.equal(read('a', 'habits.json').habits[0].done.length, 4);
  run('habit', 'undo', 'gym', '-5', '-6');
  // Not a future day, and the domain must exist.
  assert.match(runAll('habit', 'done', 'gym', 'tomorrow').stderr, /has not come yet/);
  assert.match(runAll('habit', 'add', 'Swim', '--domain', 'nowhere', '--freq', 'daily').stderr, /unknown domain/);
  assert.match(runAll('habit', 'add', 'Swim', '--domain', 'fitness').stderr, /needs --freq/);
  // A domain lists its sub-domains' habits.
  assert.match(run('habits', '--domain', 'fitness'), /Gym/);
  assert.doesNotMatch(run('habits', '--domain', 'fitness'), /Read/);
  run('habit', 'edit', 'read', '--freq', 'mon,thu', '--notes', 'before bed');
  assert.deepEqual(read('a', 'habits.json').habits[1].freq, { type: 'days', days: [1, 4] });
  run('habit', 'archive', 'read');
  assert.doesNotMatch(run('habits'), /Read/);
  assert.match(run('habits', '--archived'), /Read — mon,thu · \d\/2 this week · books · archived/);
  assert.equal(runAll('habit', 'delete', 'read').status, 1);
  run('habit', 'delete', 'read', '--yes');
  assert.deepEqual(read('a', 'habits.json').habits.map((/** @type {any} */ h) => h.title), ['Gym']);
});
