// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };
const DOMAINS = { version: 1, domains: [{ id: 'reading', name: 'Reading' }, { id: 'work', name: 'Work' }] };

test('books: add, status with dates, rating, quotes, edit, list and delete', () => {
  const { dir, run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  assert.match(run('book', 'add', 'A Novel', '--domain', 'reading', '--author', 'Some Writer'),
    /^books: new “A Novel”\n· \[b_\w+\] A Novel — want to read · Some Writer · reading\n$/);
  assert.equal(git(join(dir, 'a'), 'log', '-1', '--format=%s'), 'books: new “A Novel”\n');
  assert.equal(read('a', 'books.json').timeZone, 'UTC');
  run('book', 'reading', 'novel');
  assert.match(run('books'), /▸ \[b_\w+\] A Novel — reading · Some Writer · \d{4}-\d{2}-\d{2} · reading/);
  run('book', 'quote', 'novel', 'A line worth keeping.', '--page', '81');
  run('book', 'read', 'novel');
  run('book', 'rate', 'novel', '4');
  run('book', 'edit', 'novel', '--notes', 'Slow start, great end.');
  const [b] = read('a', 'books.json').books;
  assert.equal(b.status, 'read');
  assert.equal(b.rating, 4);
  assert.ok(b.started && b.finished);
  assert.deepEqual(b.quotes.map((/** @type {any} */ q) => [q.text, q.page]), [['A line worth keeping.', 81]]);
  const shown = run('book', 'show', 'novel');
  assert.match(shown, /★★★★/);
  assert.match(shown, /  \| Slow start, great end\./);
  assert.match(shown, /  “A line worth keeping\.” \(p\. 81\) \[q_\w+\]/);
  run('book', 'quote', 'novel', '--remove', b.quotes[0].id);
  run('book', 'rate', 'novel', 'none');
  assert.deepEqual([read('a', 'books.json').books[0].quotes, read('a', 'books.json').books[0].rating], [[], null]);
  // Another domain, and the status filter.
  run('book', 'add', 'Manual', '--domain', 'work', '--status', 'reading');
  assert.match(run('books', '--status', 'reading'), /Manual/);
  assert.doesNotMatch(run('books', '--status', 'reading'), /A Novel/);
  assert.match(runAll('book', 'delete', 'novel').stderr, /--yes/);
  run('book', 'delete', 'novel', '--yes');
  assert.deepEqual(read('a', 'books.json').books.map((/** @type {any} */ x) => x.title), ['Manual']);
});

test('a book without a domain is general reading', () => {
  const { run, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  assert.match(run('book', 'add', 'A Story'), /^books: new “A Story”\n· \[b_\w+\] A Story — want to read\n$/);
  assert.equal(read('a', 'books.json').books[0].domain, null);
  assert.match(run('books'), /A Story/);
  assert.doesNotMatch(run('books', '--domain', 'reading'), /A Story/);
  run('book', 'edit', 'story', '--domain', 'reading');
  assert.equal(read('a', 'books.json').books[0].domain, 'reading');
  run('book', 'edit', 'story', '--domain', 'none');
  assert.equal(read('a', 'books.json').books[0].domain, null);
});
