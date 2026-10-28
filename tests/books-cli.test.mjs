// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };
const DOMAINS = { version: 1, domains: [{ id: 'reading', name: 'Reading', modules: ['books'] }, { id: 'work', name: 'Work' }] };

test('books: add, status with dates, page, rating, quotes, edit, list and delete', () => {
  const { dir, run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  assert.match(run('book', 'add', 'A Novel', '--domain', 'reading', '--author', 'Some Writer', '--pages', '320'),
    /^books: new “A Novel”\n· \[b_\w+\] A Novel — want to read · Some Writer · 320 pages · reading\n$/);
  assert.equal(git(join(dir, 'a'), 'log', '-1', '--format=%s'), 'books: new “A Novel”\n');
  assert.equal(read('a', 'books.json').timeZone, 'UTC');
  run('book', 'reading', 'novel');
  run('book', 'page', 'novel', '80');
  assert.match(run('books'), /▸ \[b_\w+\] A Novel — reading · Some Writer · p\. 80\/320 · \d{4}-\d{2}-\d{2} · reading/);
  assert.match(runAll('book', 'page', 'novel', '400').stderr, /from 0 to 320/);
  run('book', 'quote', 'novel', 'A line worth keeping.', '--page', '81');
  run('book', 'read', 'novel');
  run('book', 'rate', 'novel', '4');
  run('book', 'edit', 'novel', '--notes', 'Slow start, great end.');
  const [b] = read('a', 'books.json').books;
  assert.equal(b.status, 'read');
  assert.equal(b.page, 320);
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
  // A domain without the module still works, with a note; status filter.
  const other = runAll('book', 'add', 'Manual', '--domain', 'work', '--status', 'reading');
  assert.match(other.stderr, /“work” does not list the books module/);
  assert.match(run('books', '--status', 'reading'), /Manual/);
  assert.doesNotMatch(run('books', '--status', 'reading'), /A Novel/);
  assert.match(runAll('book', 'delete', 'novel').stderr, /--yes/);
  run('book', 'delete', 'novel', '--yes');
  assert.deepEqual(read('a', 'books.json').books.map((/** @type {any} */ x) => x.title), ['Manual']);
});

test('domain modules from the CLI', () => {
  const { run, runAll, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
  run('domain', 'edit', 'work', '--add-module', 'Books');
  assert.deepEqual(read('a', 'domains.json').domains[1].modules, ['books']);
  assert.match(run('domains'), /^work — Work · \+ books$/m);
  run('domain', 'edit', 'work', '--remove-module', 'books');
  assert.equal(read('a', 'domains.json').domains[1].modules, undefined);
  assert.match(runAll('domain', 'add', 'x', '--module', 'films').stderr, /unknown module “films”/);
});
