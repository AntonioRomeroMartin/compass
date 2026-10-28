// @ts-check
// Data model of books.json and edit operations (same shape as the other data files: normalize,
// applyOps re-applied on the latest version, serialize, commitMessage), plus the Open Library search.
//
// A book goes want → reading → read (or dropped). Changing the status fills in its dates: reading sets the day it
// was started, read and dropped the day it ended, want clears both. There is no page count: only the status. Only the Open Library cover id is stored;
// the image is served by Open Library.

import { isDate } from './period.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

/** @typedef {'want'|'reading'|'read'|'dropped'} Status */

/** In the order they are shown. */
export const STATUSES = /** @type {const} */ (['reading', 'want', 'read', 'dropped']);

/** @type {Record<Status, string>} */
export const STATUS_TEXT = { want: 'Want to read', reading: 'Reading', read: 'Read', dropped: 'Dropped' };

/**
 * @typedef {Object} Quote
 * @property {string} id
 * @property {string} text
 * @property {number|null} page
 */

/**
 * @typedef {Object} Book
 * @property {string} id
 * @property {string} title
 * @property {string|null} author
 * @property {string} domain          domain id (see lib/domains.js); required
 * @property {Status} status
 * @property {string|null} notes      the reader's own thoughts
 * @property {Quote[]} quotes
 * @property {string|null} started    YYYY-MM-DD, set when it moves to reading
 * @property {string|null} finished   YYYY-MM-DD, set when it is read or dropped
 * @property {number|null} rating     1-5
 * @property {string|null} olid       Open Library work key ("OL45804W")
 * @property {number|null} cover      Open Library cover id
 * @property {string} createdAt       ISO 8601
 */

/**
 * @typedef {Object} BooksDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of the civil dates
 * @property {Book[]} books
 */

/**
 * @typedef {Partial<Pick<Book, 'title'|'author'|'domain'|'notes'|'started'|'finished'|'rating'|'olid'|'cover'>>} BookFields
 */

/**
 * @typedef {{ type: 'add', book: Book }
 *   | { type: 'edit', id: string, fields: BookFields }
 *   | { type: 'status', id: string, status: Status, today: string }
 *   | { type: 'addQuote', id: string, quote: Quote }
 *   | { type: 'editQuote', id: string, quoteId: string, fields: Partial<Pick<Quote, 'text'|'page'>> }
 *   | { type: 'removeQuote', id: string, quoteId: string }
 *   | { type: 'delete', id: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** @param {string} [timeZone] @returns {BooksDoc} */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), books: [] };
}

/** @param {unknown} v @returns {v is Status} */
export const isStatus = (v) => typeof v === 'string' && v in STATUS_TEXT;

/**
 * A status as typed: want (to-read), reading, read (done), dropped (abandoned).
 * @param {string} text
 * @returns {Status}
 */
export function parseStatus(text) {
  const s = text.trim().toLowerCase();
  /** @type {Record<string, Status>} */
  const aliases = { 'to-read': 'want', todo: 'want', done: 'read', finished: 'read', abandoned: 'dropped', drop: 'dropped' };
  const status = aliases[s] ?? s;
  if (isStatus(status)) return status;
  throw new Error(`unknown status “${text}” (want, reading, read, dropped)`);
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** A whole number in a range, or null. @param {unknown} v @param {number} min @param {number} [max] */
const intOrNull = (v, min, max = Infinity) => (Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max ? /** @type {number} */ (v) : null);

/**
 * Normalizes a document that was read (tolerates missing fields; drops books without id or title).
 * @param {any} raw
 * @returns {BooksDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const books = (Array.isArray(doc.books) ? doc.books : [])
    .filter((/** @type {any} */ x) => x && typeof x.id === 'string' && typeof x.title === 'string' && x.title.trim())
    // Pages were dropped (2026-10-28): files written before keep no `page` or `pages`.
    .map(({ page: _page, pages: _pages, .../** @type {any} */ x }) => /** @type {Book} */ ({
      ...x,
      author: textOrNull(x.author),
      domain: typeof x.domain === 'string' ? x.domain : '',
      status: isStatus(x.status) ? x.status : 'want',
      notes: textOrNull(x.notes),
      quotes: (Array.isArray(x.quotes) ? x.quotes : [])
        .filter((/** @type {any} */ q) => q && typeof q.id === 'string' && textOrNull(q.text))
        .map((/** @type {any} */ q) => ({ id: q.id, text: q.text, page: intOrNull(q.page, 1) })),
      started: isDate(x.started) ? x.started : null,
      finished: isDate(x.finished) ? x.finished : null,
      rating: intOrNull(x.rating, 1, 5),
      olid: textOrNull(x.olid),
      cover: intOrNull(x.cover, 1),
      createdAt: typeof x.createdAt === 'string' ? x.createdAt : '',
    }));
  return { ...doc, version: Number(doc.version) || 1, books };
}

/**
 * New book with every field filled in.
 * @param {Pick<Book, 'title'|'domain'> & Partial<Book>} fields
 * @param {Date} [now]
 * @returns {Book}
 */
export function newBook(fields, now = new Date()) {
  return {
    id: newId('b_'), author: null, status: 'want', notes: null, quotes: [], started: null, finished: null,
    rating: null, olid: null, cover: null, createdAt: now.toISOString(), ...fields,
  };
}

/**
 * The dates a status change leaves.
 * @param {Book} b @param {Status} status @param {string} today
 * @returns {Pick<Book, 'status'|'started'|'finished'>}
 */
export function withStatus(b, status, today) {
  switch (status) {
    case 'want': return { status, started: null, finished: null };
    case 'reading': return { status, started: b.started ?? today, finished: null };
    case 'read':
    case 'dropped': return { status, started: b.started, finished: today };
  }
}

/** Books read in a year (by the day they were finished). @param {BooksDoc} doc @param {string} year "2026" */
export const readIn = (doc, year) => doc.books.filter((b) => b.status === 'read' && b.finished?.startsWith(year));

/** Order of a list: by status, then the latest change first. @param {Book} a @param {Book} b */
export function byStatus(a, b) {
  const s = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
  if (s) return s;
  const when = (/** @type {Book} */ x) => x.finished ?? x.started ?? x.createdAt;
  return when(b).localeCompare(when(a));
}

/**
 * Applies operations to a copy of the document. Operations on books that no longer exist are ignored.
 * @param {BooksDoc} doc
 * @param {Op[]} ops
 * @returns {BooksDoc}
 */
export function applyOps(doc, ops) {
  /** @type {BooksDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.books.find((x) => x.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.book.id)) out.books.push(structuredClone(op.book));
        break;
      case 'edit': {
        const b = find(op.id);
        if (b) Object.assign(b, structuredClone(op.fields));
        break;
      }
      case 'status': {
        const b = find(op.id);
        if (b && b.status !== op.status) Object.assign(b, withStatus(b, op.status, op.today));
        break;
      }
      case 'addQuote': {
        const b = find(op.id);
        if (b && !b.quotes.some((q) => q.id === op.quote.id)) b.quotes.push(structuredClone(op.quote));
        break;
      }
      case 'editQuote': {
        const q = find(op.id)?.quotes.find((x) => x.id === op.quoteId);
        if (q) Object.assign(q, structuredClone(op.fields));
        break;
      }
      case 'removeQuote': {
        const b = find(op.id);
        if (b) b.quotes = b.quotes.filter((q) => q.id !== op.quoteId);
        break;
      }
      case 'delete':
        out.books = out.books.filter((x) => x.id !== op.id);
        break;
      case 'setTimeZone':
        out.timeZone = op.timeZone;
        break;
    }
  }
  return out;
}

/**
 * Commit message for a batch of operations.
 * @param {Op[]} ops
 * @param {BooksDoc} before  base document (titles of what was deleted)
 * @param {BooksDoc} after
 */
export function commitMessage(ops, before, after) {
  /** @param {string} id */
  const title = (id) => after.books.find((x) => x.id === id)?.title ?? before.books.find((x) => x.id === id)?.title ?? id;
  const parts = new Set();
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new “${op.book.title}”`); break;
      case 'edit': parts.add(`edited “${title(op.id)}”`); break;
      case 'status': parts.add(`“${title(op.id)}” ${op.status}`); break;
      case 'addQuote':
      case 'editQuote':
      case 'removeQuote': parts.add(`quotes “${title(op.id)}”`); break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  const text = [...parts].join(', ');
  return `books: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}

// ---- Open Library ----

export const OPEN_LIBRARY = 'https://openlibrary.org';
export const COVERS = 'https://covers.openlibrary.org';

/**
 * A search result: what a new book takes from it.
 * @typedef {{ title: string, author: string|null, olid: string|null, cover: number|null, year: number|null }} Found
 */

/** URL of a cover image. @param {number} cover @param {'S'|'M'|'L'} [size] */
export const coverUrl = (cover, size = 'M') => `${COVERS}/b/id/${cover}-${size}.jpg`;

/**
 * Books matching a text (title, author or both), best first.
 * @param {string} query
 * @param {{ limit?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<Found[]>}
 */
export async function search(query, opts = {}) {
  const url = new URL('/search.json', OPEN_LIBRARY);
  url.searchParams.set('q', query);
  url.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year');
  url.searchParams.set('limit', String(opts.limit ?? 10));
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
  return parseSearch(await res.json());
}

/**
 * The results of /search.json as `Found` (exported for tests).
 * @param {any} json
 * @returns {Found[]}
 */
export function parseSearch(json) {
  return (Array.isArray(json?.docs) ? json.docs : [])
    .filter((/** @type {any} */ d) => textOrNull(d?.title))
    .map((/** @type {any} */ d) => ({
      title: d.title,
      author: Array.isArray(d.author_name) && d.author_name.length ? d.author_name.slice(0, 2).join(', ') : null,
      olid: typeof d.key === 'string' ? d.key.replace(/^\/works\//, '') : null,
      cover: intOrNull(d.cover_i, 1),
      year: intOrNull(d.first_publish_year, 0),
    }));
}
