// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as books from '../lib/books.js';

const NOW = new Date('2026-03-02T10:00:00Z');

test('a status change sets the dates', () => {
  const b = books.newBook({ title: 'A novel', domain: 'reading' }, NOW);
  let doc = books.applyOps(books.emptyDoc('UTC'), [{ type: 'add', book: b }]);
  doc = books.applyOps(doc, [{ type: 'status', id: b.id, status: 'reading', today: '2026-03-02' }]);
  assert.deepEqual([doc.books[0].started, doc.books[0].finished], ['2026-03-02', null]);
  // Re-applying the same status changes nothing: the start day stays.
  doc = books.applyOps(doc, [{ type: 'status', id: b.id, status: 'reading', today: '2026-03-09' }]);
  assert.equal(doc.books[0].started, '2026-03-02');
  doc = books.applyOps(doc, [{ type: 'status', id: b.id, status: 'read', today: '2026-03-20' }]);
  assert.deepEqual([doc.books[0].started, doc.books[0].finished], ['2026-03-02', '2026-03-20']);
  assert.equal(books.readIn(doc, '2026').length, 1);
  assert.equal(books.readIn(doc, '2025').length, 0);
  doc = books.applyOps(doc, [{ type: 'status', id: b.id, status: 'want', today: '2026-03-21' }]);
  assert.deepEqual([doc.books[0].started, doc.books[0].finished], [null, null]);
});

test('quotes: add, edit and remove', () => {
  const b = books.newBook({ title: 'Essays', domain: 'reading' }, NOW);
  let doc = books.applyOps(books.emptyDoc(), [{ type: 'add', book: b }, { type: 'addQuote', id: b.id, quote: { id: 'q1', text: 'Short line.', page: 12 } }]);
  doc = books.applyOps(doc, [{ type: 'editQuote', id: b.id, quoteId: 'q1', fields: { page: 13 } }]);
  assert.deepEqual(doc.books[0].quotes, [{ id: 'q1', text: 'Short line.', page: 13 }]);
  assert.equal(books.commitMessage([{ type: 'removeQuote', id: b.id, quoteId: 'q1' }], doc, doc), 'books: quotes “Essays”');
  doc = books.applyOps(doc, [{ type: 'removeQuote', id: b.id, quoteId: 'q1' }]);
  assert.deepEqual(doc.books[0].quotes, []);
});

test('normalize fills missing fields and drops bad values (and the pages of older files)', () => {
  const doc = books.normalize({ books: [
    { id: 'b1', title: 'Kept', status: 'lost', rating: 9, page: 3, pages: 10, cover: 123, quotes: [{ id: 'q', text: '' }, { id: 'r', text: 'ok', page: 'x' }] },
    { id: 'b2', title: '' },
  ] });
  assert.equal(doc.books.length, 1);
  const [b] = doc.books;
  assert.deepEqual([b.status, b.rating, b.cover, b.author, b.started, b.domain], ['want', null, 123, null, null, null]);
  assert.ok(!('page' in b) && !('pages' in b));
  assert.deepEqual(b.quotes, [{ id: 'r', text: 'ok', page: null }]);
});

test('parseStatus and the Open Library results', () => {
  assert.equal(books.parseStatus('Done'), 'read');
  assert.equal(books.parseStatus('to-read'), 'want');
  assert.throws(() => books.parseStatus('soon'), /unknown status/);
  const found = books.parseSearch({ docs: [
    { key: '/works/OL1W', title: 'A Book', author_name: ['One', 'Two', 'Three'], cover_i: 42, number_of_pages_median: 210, first_publish_year: 1999 },
    { key: '/works/OL2W', title: 'Bare' },
    { title: '' },
  ] });
  assert.deepEqual(found, [
    { title: 'A Book', author: 'One, Two', olid: 'OL1W', cover: 42, year: 1999 },
    { title: 'Bare', author: null, olid: 'OL2W', cover: null, year: null },
  ]);
  assert.equal(books.coverUrl(42, 'S'), 'https://covers.openlibrary.org/b/id/42-S.jpg');
});
