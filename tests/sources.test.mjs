// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../lib/sources.js';

const NOW = new Date('2026-03-02T10:00:00Z');

test('a status change sets the dates', () => {
  const s = sources.newSource({ title: 'A novel', domain: 'reading' }, NOW);
  let doc = sources.applyOps(sources.emptyDoc('UTC'), [{ type: 'add', source: s }]);
  doc = sources.applyOps(doc, [{ type: 'status', id: s.id, status: 'doing', today: '2026-03-02' }]);
  assert.deepEqual([doc.sources[0].started, doc.sources[0].finished], ['2026-03-02', null]);
  // Re-applying the same mark changes nothing: the start day stays.
  doc = sources.applyOps(doc, [{ type: 'status', id: s.id, status: 'doing', today: '2026-03-09' }]);
  assert.equal(doc.sources[0].started, '2026-03-02');
  doc = sources.applyOps(doc, [{ type: 'status', id: s.id, status: 'done', today: '2026-03-20' }]);
  assert.deepEqual([doc.sources[0].started, doc.sources[0].finished], ['2026-03-02', '2026-03-20']);
  assert.equal(sources.doneIn(doc, '2026').length, 1);
  assert.equal(sources.doneIn(doc, '2025').length, 0);
  doc = sources.applyOps(doc, [{ type: 'status', id: s.id, status: null, today: '2026-03-21' }]);
  assert.deepEqual([doc.sources[0].status, doc.sources[0].started, doc.sources[0].finished], [null, null, null]);
});

test('commit messages name the kind of what is added', () => {
  const s = sources.newSource({ title: 'A talk', kind: 'video', url: 'https://example.com/v' }, NOW);
  const doc = sources.applyOps(sources.emptyDoc(), [{ type: 'add', source: s }]);
  assert.equal(sources.commitMessage([{ type: 'add', source: s }], doc, doc), 'sources: new video “A talk”');
  assert.equal(sources.commitMessage([{ type: 'status', id: s.id, status: null, today: '2026-03-02' }], doc, doc), 'sources: “A talk” none');
});

test('the words of a status depend on the kind', () => {
  assert.equal(sources.statusText({ kind: 'book', status: 'doing' }), 'Reading');
  assert.equal(sources.statusText({ kind: 'video', status: 'done' }), 'Watched');
  assert.equal(sources.statusText({ kind: 'podcast', status: 'pending' }), 'Want to listen');
  assert.equal(sources.statusText({ kind: 'book', status: null }), 'Material only');
  assert.equal(sources.statusText({ kind: 'course', status: 'done' }), 'Completed');
});

test('quotes: add, edit and remove', () => {
  const s = sources.newSource({ title: 'Essays', domain: 'reading' }, NOW);
  let doc = sources.applyOps(sources.emptyDoc(), [{ type: 'add', source: s }, { type: 'addQuote', id: s.id, quote: { id: 'q1', text: 'Short line.', page: 12 } }]);
  doc = sources.applyOps(doc, [{ type: 'editQuote', id: s.id, quoteId: 'q1', fields: { page: 13 } }]);
  assert.deepEqual(doc.sources[0].quotes, [{ id: 'q1', text: 'Short line.', page: 13 }]);
  assert.equal(sources.commitMessage([{ type: 'removeQuote', id: s.id, quoteId: 'q1' }], doc, doc), 'sources: quotes “Essays”');
  doc = sources.applyOps(doc, [{ type: 'removeQuote', id: s.id, quoteId: 'q1' }]);
  assert.deepEqual(doc.sources[0].quotes, []);
});

test('normalize fills missing fields and drops bad values', () => {
  const doc = sources.normalize({ sources: [
    { id: 's1', title: 'Kept', kind: 'zine', status: 'lost', rating: 9, cover: 123, quotes: [{ id: 'q', text: '' }, { id: 'r', text: 'ok', page: 'x' }] },
    { id: 's2', title: '' },
  ] });
  assert.equal(doc.sources.length, 1);
  const [s] = doc.sources;
  assert.deepEqual([s.kind, s.status, s.rating, s.cover, s.author, s.url, s.file, s.domain], ['book', 'pending', null, 123, null, null, null, null]);
  assert.deepEqual(s.quotes, [{ id: 'r', text: 'ok', page: null }]);
});

test('a books.json from before is read as books, keeping every field', () => {
  const book = { id: 'b1', title: 'Old', author: 'Someone', domain: 'reading', status: 'reading', notes: 'n', quotes: [{ id: 'q', text: 't', page: 3 }],
    started: '2026-01-02', finished: null, rating: 4, olid: 'OL1W', cover: 7, createdAt: '2026-01-01T00:00:00.000Z', pages: 300 };
  const doc = sources.normalize({ version: 1, timeZone: 'UTC', books: [book, { ...book, id: 'b2', status: 'read', finished: '2026-02-01' }, { ...book, id: 'b3', status: 'dropped' }, { ...book, id: 'b4', status: 'want' }] });
  assert.ok(!('books' in doc));
  assert.equal(doc.timeZone, 'UTC');
  assert.deepEqual(doc.sources.map((s) => [s.id, s.kind, s.status]), [['b1', 'book', 'doing'], ['b2', 'book', 'done'], ['b3', 'book', 'done'], ['b4', 'book', 'pending']]);
  const { pages: _p, status: _s, ...rest } = book;
  assert.deepEqual(doc.sources[0], { ...rest, kind: 'book', url: null, file: null, status: 'doing' });
});

test('the earlier statuses are read as the three states, keeping the dates', () => {
  const raw = { version: 1, sources: [
    { id: 'a', title: 'A', status: 'want' },
    { id: 'b', title: 'B', status: 'dropped', started: '2026-01-02', finished: '2026-02-03' },
    { id: 'c', title: 'C', status: 'skip' },
    { id: 'd', title: 'D', status: 'doing', started: '2026-01-02' },
    { id: 'e', title: 'E', status: null },
  ] };
  assert.ok(sources.hasOldStatuses(raw));
  const doc = sources.normalize(raw);
  assert.deepEqual(doc.sources.map((s) => s.status), ['pending', 'done', null, 'doing', null]);
  assert.deepEqual([doc.sources[1].started, doc.sources[1].finished], ['2026-01-02', '2026-02-03']);
  assert.ok(!sources.hasOldStatuses(JSON.parse(sources.serialize(doc))));
  // Material only goes last, after the three states.
  assert.deepEqual([...doc.sources].sort(sources.byStatus).map((s) => s.id), ['d', 'a', 'b', 'c', 'e']);
});

test('parsing kinds and statuses, and the Open Library results', () => {
  assert.equal(sources.parseKind('Videos'), 'video');
  assert.equal(sources.parseStatus('Watched'), 'done');
  assert.equal(sources.parseStatus('reading'), 'doing');
  assert.equal(sources.parseStatus('not for me'), null);
  assert.equal(sources.parseStatus('none'), null);
  assert.equal(sources.parseStatus('want'), 'pending');
  assert.equal(sources.parseStatus('dropped'), 'done');
  assert.throws(() => sources.parseStatus('soon'), /unknown status/);
  assert.throws(() => sources.parseKind('zine'), /unknown kind/);
  const found = sources.parseSearch({ docs: [
    { key: '/works/OL1W', title: 'A Book', author_name: ['One', 'Two', 'Three'], cover_i: 42, first_publish_year: 1999 },
    { key: '/works/OL2W', title: 'Bare' },
    { title: '' },
  ] });
  assert.deepEqual(found, [
    { title: 'A Book', author: 'One, Two', olid: 'OL1W', cover: 42, year: 1999 },
    { title: 'Bare', author: null, olid: 'OL2W', cover: null, year: null },
  ]);
  assert.equal(sources.coverUrl(42, 'S'), 'https://covers.openlibrary.org/b/id/42-S.jpg');
});
