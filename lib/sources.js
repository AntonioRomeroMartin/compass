// @ts-check
// Data model of sources.json and edit operations (same shape as the other data files: normalize,
// applyOps re-applied on the latest version, serialize, commitMessage), plus the Open Library search for books.
//
// A source is anything to learn from: a book, video, course, article or podcast. Its status goes pending → doing →
// done ("done" is both finished and given up on), or it has none (null): material only, kept for the assistant and
// not meant to be consumed by the reader. Changing it fills in its dates: doing sets the day it was started, done the
// day it ended, pending and no status clear both. The words shown depend on the kind (Reading, Watching, Listening…).
// Every source has a location (`url`: a link or free text saying where to find it, e.g. "paper book, shelf") and may
// also have a local copy (`file`, relative to the `knowledge/sources/` folder of its domain's folder).
// Only the Open Library cover id is stored; the image is served by Open Library.
//
// Older files are read as the current model: books.json (`{ books: [...] }`) as books (reading → doing, read → done),
// and the earlier statuses want → pending, dropped → done, skip → none.

import { isDate } from './period.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

/** @typedef {'book'|'video'|'course'|'article'|'podcast'} Kind */
/** @typedef {'pending'|'doing'|'done'} Status */

export const KINDS = /** @type {const} */ (['book', 'video', 'course', 'article', 'podcast']);

/** @type {Record<Kind, string>} */
export const KIND_TEXT = { book: 'Book', video: 'Video', course: 'Course', article: 'Article', podcast: 'Podcast' };

/** In the order they are shown. */
export const STATUSES = /** @type {const} */ (['doing', 'pending', 'done']);

/** What a source without a status is called: material for the assistant only. */
export const NO_STATUS_TEXT = 'Material only';

/** The status in the words of each kind. @type {Record<Kind, Record<Status, string>>} */
export const STATUS_TEXT = {
  book: { pending: 'Want to read', doing: 'Reading', done: 'Read' },
  article: { pending: 'Want to read', doing: 'Reading', done: 'Read' },
  video: { pending: 'Want to watch', doing: 'Watching', done: 'Watched' },
  course: { pending: 'Want to take', doing: 'Taking', done: 'Completed' },
  podcast: { pending: 'Want to listen', doing: 'Listening', done: 'Listened' },
};

/** The status for any kind (lists that mix kinds). @type {Record<Status, string>} */
export const STATUS_ANY = { pending: 'Pending', doing: 'In progress', done: 'Done' };

/**
 * @typedef {Object} Quote
 * @property {string} id
 * @property {string} text
 * @property {number|null} page
 */

/**
 * @typedef {Object} Source
 * @property {string} id
 * @property {Kind} kind
 * @property {string} title
 * @property {string|null} author     author, channel or host
 * @property {string|null} url        where to find it: a link or free text ("paper book, shelf")
 * @property {string|null} file       local copy: path relative to the `knowledge/sources/` folder of its domain's folder
 * @property {string|null} domain     domain id (see lib/domains.js); null = general, in no area
 * @property {Status|null} status    null = material only (not meant to be consumed)
 * @property {string|null} notes      the reader's own thoughts
 * @property {Quote[]} quotes
 * @property {string|null} started    YYYY-MM-DD, set when it moves to doing
 * @property {string|null} finished   YYYY-MM-DD, set when it is done
 * @property {number|null} rating     1-5
 * @property {string|null} olid       Open Library work key ("OL45804W"), books only
 * @property {number|null} cover      Open Library cover id, books only
 * @property {string} createdAt       ISO 8601
 */

/**
 * @typedef {Object} SourcesDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of the civil dates
 * @property {Source[]} sources
 */

/**
 * @typedef {Partial<Pick<Source, 'kind'|'title'|'author'|'url'|'file'|'domain'|'notes'|'started'|'finished'|'rating'|'olid'|'cover'>>} SourceFields
 */

/**
 * @typedef {{ type: 'add', source: Source }
 *   | { type: 'edit', id: string, fields: SourceFields }
 *   | { type: 'status', id: string, status: Status|null, today: string }
 *   | { type: 'addQuote', id: string, quote: Quote }
 *   | { type: 'editQuote', id: string, quoteId: string, fields: Partial<Pick<Quote, 'text'|'page'>> }
 *   | { type: 'removeQuote', id: string, quoteId: string }
 *   | { type: 'delete', id: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** @param {string} [timeZone] @returns {SourcesDoc} */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), sources: [] };
}

/** @param {unknown} v @returns {v is Kind} */
export const isKind = (v) => typeof v === 'string' && v in KIND_TEXT;
/** @param {unknown} v @returns {v is Status} */
export const isStatus = (v) => typeof v === 'string' && v in STATUS_ANY;

/** The words of a source's status (none: material only). @param {Pick<Source, 'kind'|'status'>} s */
export const statusText = (s) => (s.status ? STATUS_TEXT[s.kind][s.status] : NO_STATUS_TEXT);

/**
 * A kind as typed (also plurals and a few other words).
 * @param {string} text
 * @returns {Kind}
 */
export function parseKind(text) {
  const s = text.trim().toLowerCase().replace(/s$/, '');
  /** @type {Record<string, Kind>} */
  const aliases = { vídeo: 'video', paper: 'article', post: 'article', episode: 'podcast' };
  const kind = aliases[s] ?? s;
  if (isKind(kind)) return kind;
  throw new Error(`unknown kind “${text}” (${KINDS.join(', ')})`);
}

/**
 * A status as typed: pending, doing, done, none (material only), or the words of any kind (reading, watched…);
 * the earlier names still work (want, dropped, skip). `null` is "no status".
 * @param {string} text
 * @returns {Status|null}
 */
export function parseStatus(text) {
  const s = text.trim().toLowerCase().replace(/[\s_]+/g, '-');
  /** @type {Record<string, Status|null>} */
  const aliases = {
    want: 'pending', 'to-read': 'pending', todo: 'pending',
    reading: 'doing', watching: 'doing', taking: 'doing', listening: 'doing', 'in-progress': 'doing',
    read: 'done', watched: 'done', completed: 'done', listened: 'done', finished: 'done',
    dropped: 'done', abandoned: 'done', drop: 'done',
    none: null, skip: null, 'not-for-me': null, 'material-only': null, material: null,
  };
  const status = s in aliases ? aliases[s] : s;
  if (status === null || isStatus(status)) return status;
  throw new Error(`unknown status “${text}” (pending, doing, done, none)`);
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** A whole number in a range, or null. @param {unknown} v @param {number} min @param {number} [max] */
const intOrNull = (v, min, max = Infinity) => (Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max ? /** @type {number} */ (v) : null);

/** Status of a file written before sources (books.json). @type {Record<string, Status>} */
const BOOK_STATUS = { want: 'pending', reading: 'doing', read: 'done', dropped: 'done' };

/** Status of a file written before the three states. `null` = no status. @type {Record<string, Status|null>} */
const OLD_STATUS = { want: 'pending', dropped: 'done', skip: null };

/**
 * The status as read: the current ones as they are, the earlier ones mapped, a missing one pending.
 * @param {any} x  the raw source (or book)  @param {boolean} fromBooks
 * @returns {Status|null}
 */
function readStatus(x, fromBooks) {
  if (fromBooks) return BOOK_STATUS[x.status] ?? 'pending';
  if (x.status === null) return null;
  if (isStatus(x.status)) return x.status;
  return typeof x.status === 'string' && x.status in OLD_STATUS ? OLD_STATUS[x.status] : 'pending';
}

/**
 * Normalizes a document that was read (tolerates missing fields; drops sources without id or title). Also reads
 * books.json (`{ books: [...] }`): every entry is a book, its status mapped.
 * @param {any} raw
 * @returns {SourcesDoc}
 */
export function normalize(raw) {
  const { books: oldBooks, ...doc } = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fromBooks = !Array.isArray(doc.sources) && Array.isArray(oldBooks);
  const list = fromBooks ? oldBooks : Array.isArray(doc.sources) ? doc.sources : [];
  const sources = list
    .filter((/** @type {any} */ x) => x && typeof x.id === 'string' && typeof x.title === 'string' && x.title.trim())
    // Pages were dropped (2026-10-28): files written before keep no `page` or `pages`.
    .map(({ page: _page, pages: _pages, .../** @type {any} */ x }) => {
      return /** @type {Source} */ ({
        id: x.id,
        kind: isKind(x.kind) ? x.kind : 'book',
        title: x.title,
        author: textOrNull(x.author),
        url: textOrNull(x.url),
        file: textOrNull(x.file),
        domain: textOrNull(x.domain),
        status: readStatus(x, fromBooks),
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
      });
    });
  return { ...doc, version: Number(doc.version) || 1, sources };
}

/**
 * New source with every field filled in (a book unless said otherwise).
 * @param {Pick<Source, 'title'> & Partial<Source>} fields
 * @param {Date} [now]
 * @returns {Source}
 */
export function newSource(fields, now = new Date()) {
  return {
    id: newId('s_'), kind: 'book', author: null, url: null, file: null, domain: null, status: 'pending',
    notes: null, quotes: [], started: null, finished: null, rating: null, olid: null, cover: null,
    createdAt: now.toISOString(), ...fields,
  };
}

/**
 * The dates a status change leaves.
 * @param {Source} s @param {Status|null} status @param {string} today
 * @returns {Pick<Source, 'status'|'started'|'finished'>}
 */
export function withStatus(s, status, today) {
  switch (status) {
    case null:
    case 'pending': return { status, started: null, finished: null };
    case 'doing': return { status, started: s.started ?? today, finished: null };
    case 'done': return { status, started: s.started, finished: today };
  }
}

/** Is a raw document written with the earlier statuses (so `compass sources migrate` has to rewrite it)? @param {any} raw */
export const hasOldStatuses = (raw) => Array.isArray(raw?.sources)
  && raw.sources.some((/** @type {any} */ x) => x && !(x.status === null || isStatus(x.status)));

/** Sources finished in a year (by the day they were finished). @param {SourcesDoc} doc @param {string} year "2026" */
export const doneIn = (doc, year) => doc.sources.filter((s) => s.status === 'done' && s.finished?.startsWith(year));

/** Order of a list: by status (none last), then the latest change first. @param {Source} a @param {Source} b */
export function byStatus(a, b) {
  const rank = (/** @type {Source} */ x) => (x.status ? STATUSES.indexOf(x.status) : STATUSES.length);
  const s = rank(a) - rank(b);
  if (s) return s;
  const when = (/** @type {Source} */ x) => x.finished ?? x.started ?? x.createdAt;
  return when(b).localeCompare(when(a));
}

/**
 * Applies operations to a copy of the document. Operations on sources that no longer exist are ignored.
 * @param {SourcesDoc} doc
 * @param {Op[]} ops
 * @returns {SourcesDoc}
 */
export function applyOps(doc, ops) {
  /** @type {SourcesDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.sources.find((x) => x.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add':
        if (!find(op.source.id)) out.sources.push(structuredClone(op.source));
        break;
      case 'edit': {
        const s = find(op.id);
        if (s) Object.assign(s, structuredClone(op.fields));
        break;
      }
      case 'status': {
        const s = find(op.id);
        if (s && s.status !== op.status) Object.assign(s, withStatus(s, op.status, op.today));
        break;
      }
      case 'addQuote': {
        const s = find(op.id);
        if (s && !s.quotes.some((q) => q.id === op.quote.id)) s.quotes.push(structuredClone(op.quote));
        break;
      }
      case 'editQuote': {
        const q = find(op.id)?.quotes.find((x) => x.id === op.quoteId);
        if (q) Object.assign(q, structuredClone(op.fields));
        break;
      }
      case 'removeQuote': {
        const s = find(op.id);
        if (s) s.quotes = s.quotes.filter((q) => q.id !== op.quoteId);
        break;
      }
      case 'delete':
        out.sources = out.sources.filter((x) => x.id !== op.id);
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
 * @param {SourcesDoc} before  base document (titles of what was deleted)
 * @param {SourcesDoc} after
 */
export function commitMessage(ops, before, after) {
  /** @param {string} id */
  const title = (id) => after.sources.find((x) => x.id === id)?.title ?? before.sources.find((x) => x.id === id)?.title ?? id;
  const parts = new Set();
  for (const op of ops) {
    switch (op.type) {
      case 'add': parts.add(`new ${op.source.kind} “${op.source.title}”`); break;
      case 'edit': parts.add(`edited “${title(op.id)}”`); break;
      case 'status': parts.add(`“${title(op.id)}” ${op.status ?? 'none'}`); break;
      case 'addQuote':
      case 'editQuote':
      case 'removeQuote': parts.add(`quotes “${title(op.id)}”`); break;
      case 'delete': parts.add(`deleted “${title(op.id)}”`); break;
      case 'setTimeZone': parts.add(`time zone ${op.timeZone}`); break;
    }
  }
  const text = [...parts].join(', ');
  return `sources: ${text.length > 120 ? text.slice(0, 117) + '…' : text || 'update'}`;
}

// ---- Open Library (books) ----

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
