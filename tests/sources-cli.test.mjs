// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };
const DOMAINS = { version: 1, domains: [{ id: 'reading', name: 'Reading' }, { id: 'work', name: 'Work' }] };

test('sources: add, status with dates, rating, quotes, edit, list and delete', () => {
  const { dir, run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  assert.match(run('source', 'add', 'A Novel', '--domain', 'reading', '--author', 'Some Writer'),
    /^sources: new book “A Novel”\n· \[s_\w+\] A Novel — book · want to read · Some Writer · reading\n$/);
  assert.equal(git(join(dir, 'a'), 'log', '-1', '--format=%s'), 'sources: new book “A Novel”\n');
  assert.equal(read('a', 'sources.json').timeZone, 'UTC');
  run('source', 'reading', 'novel');
  assert.match(run('sources'), /▸ \[s_\w+\] A Novel — book · reading · Some Writer · \d{4}-\d{2}-\d{2} · reading/);
  run('source', 'quote', 'novel', 'A line worth keeping.', '--page', '81');
  run('source', 'done', 'novel');
  run('source', 'rate', 'novel', '4');
  run('source', 'edit', 'novel', '--notes', 'Slow start, great end.');
  const [s] = read('a', 'sources.json').sources;
  assert.deepEqual([s.status, s.rating], ['done', 4]);
  assert.ok(s.started && s.finished);
  assert.deepEqual(s.quotes.map((/** @type {any} */ q) => [q.text, q.page]), [['A line worth keeping.', 81]]);
  const shown = run('source', 'show', 'novel');
  assert.match(shown, /book · read · Some Writer · ★★★★/);
  assert.match(shown, /  \| Slow start, great end\./);
  assert.match(shown, /  “A line worth keeping\.” \(p\. 81\) \[q_\w+\]/);
  run('source', 'quote', 'novel', '--remove', s.quotes[0].id);
  run('source', 'rate', 'novel', 'none');
  assert.deepEqual([read('a', 'sources.json').sources[0].quotes, read('a', 'sources.json').sources[0].rating], [[], null]);
  assert.match(runAll('source', 'delete', 'novel').stderr, /--yes/);
  run('source', 'delete', 'novel', '--yes');
  assert.deepEqual(read('a', 'sources.json').sources, []);
});

test('sources: kinds, link and file, and the filters', () => {
  const { run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  assert.match(run('source', 'add', 'A Talk', '--kind', 'video', '--domain', 'work', '--url', 'https://example.com/v', '--file', 'talk.txt', '--status', 'skip'),
    /– \[s_\w+\] A Talk — video · not for me · work/);
  run('source', 'add', 'A Story');
  assert.equal(read('a', 'sources.json').sources[1].domain, null);
  run('source', 'add', 'A Show', '--kind', 'podcast', '--domain', 'work');
  run('source', 'listening', 'show');
  assert.match(run('sources', '--kind', 'podcast'), /A Show — podcast · listening/);
  assert.match(run('sources', '--status', 'not-for-me'), /A Talk/);
  assert.doesNotMatch(run('sources', '--status', 'not-for-me'), /A Show|A Story/);
  assert.doesNotMatch(run('sources', '--domain', 'work'), /A Story/);
  assert.match(run('source', 'show', 'talk'), /  Link: https:\/\/example\.com\/v\n  File: sources\/talk\.txt/);
  run('source', 'edit', 'talk', '--url', 'none', '--kind', 'course');
  const t = read('a', 'sources.json').sources[0];
  assert.deepEqual([t.url, t.kind, t.status], [null, 'course', 'skip']);
  run('source', 'edit', 'story', '--domain', 'reading');
  assert.equal(read('a', 'sources.json').sources[1].domain, 'reading');
  assert.match(runAll('sources', '--kind', 'zine').stderr, /unknown kind/);
  assert.match(runAll('source', 'add', 'X', '--kind', 'video', '--find').stderr, /only for books/);
});

test('sources migrate: books.json becomes sources.json in one commit', () => {
  const books = { version: 1, timeZone: 'UTC', books: [
    { id: 'b_1', title: 'Old Book', author: 'A', domain: 'reading', status: 'reading', notes: null, quotes: [], started: '2026-01-02', finished: null, rating: null, olid: null, cover: null, createdAt: '2026-01-01T00:00:00.000Z' },
  ] };
  const { dir, run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS, 'books.json': books });
  assert.match(runAll('sources').stderr, /sources migrate/);
  assert.match(runAll('source', 'add', 'New').stderr, /sources migrate/);
  assert.match(run('sources', 'migrate'), /sources: from books\.json \(1 book\)/);
  assert.ok(!existsSync(join(dir, 'a', 'books.json')));
  assert.equal(git(join(dir, 'a'), 'show', '--name-status', '--no-renames', '--format=', 'HEAD'), 'D\tbooks.json\nA\tsources.json\n');
  const [s] = read('a', 'sources.json').sources;
  assert.deepEqual([s.id, s.kind, s.status, s.started], ['b_1', 'book', 'doing', '2026-01-02']);
  assert.match(run('sources'), /▸ \[b_1\] Old Book — book · reading · A/);
  assert.match(runAll('sources', 'migrate').stderr, /already exists/);
  // The other clone gets it on its next pull.
  git(join(dir, 'b'), 'pull', '-q');
  assert.ok(existsSync(join(dir, 'b', 'sources.json')) && !existsSync(join(dir, 'b', 'books.json')));
});
