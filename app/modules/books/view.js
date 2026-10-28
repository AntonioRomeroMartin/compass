// @ts-check
// Books module (app side): book rows grouped by status (area page and Books tab), the book's own sheet (status,
// rating, notes, quotes), the new/edit sheet with the Open Library search, and the area's card on Home.
import * as domainsLib from '../../../lib/domains.js';
import * as booksLib from '../../../lib/books.js';
import { booksStore, canEdit, dispatchBooks, domainsStore, inAreas, todayKey } from '../../core/data.js';
import { $, areaPicker, chipPicker, h } from '../../core/ui.js';

/** @typedef {import('../../../lib/books.js').Book} Book */
/** @typedef {import('../../../lib/books.js').Status} Status */

/** The cover, or an empty frame of the same size. @param {Book | booksLib.Found} b @param {'S'|'M'|'L'} size */
function cover(b, size) {
  const cls = `cover cover-${size.toLowerCase()}`;
  if (!b.cover) return h('span', { class: `${cls} blank`, 'aria-hidden': 'true' });
  return h('img', { class: cls, src: booksLib.coverUrl(b.cover, size), alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
}

/** Five stars, the first `n` filled. @param {number} n */
const stars = (n) => h('span', { class: 'stars', 'aria-label': `${n} of 5` }, '★'.repeat(n), h('span', { class: 'off' }, '★'.repeat(5 - n)));

/**
 * A book's row: small cover, title and author; the stars once rated.
 * @param {Book} b @param {{ area?: string|null }} [show]  also a chip with its area
 */
export function bookRow(b, show = {}) {
  return h(
    'li',
    { class: 'book-row' },
    h(
      'button',
      { class: 'book-open', onclick: () => openBook(b) },
      cover(b, 'S'),
      h(
        'span',
        { class: 'book-text' },
        h('span', { class: 'book-title' }, b.title),
        b.author ? h('span', { class: 'hint' }, b.author) : null,
      ),
      h(
        'span',
        { class: 'task-meta' },
        show.area ? h('span', { class: 'chip muted' }, show.area) : null,
        b.rating ? stars(b.rating) : null,
      ),
    ),
  );
}

/**
 * Books grouped by status: Reading, Want to read, Read this year; read earlier and dropped, folded.
 * @param {Book[]} list @param {(b: Book) => string|null} [areaOf]  chip with the book's area
 * @returns {HTMLElement[]}
 */
export function bookGroups(list, areaOf = () => null) {
  const year = todayKey().slice(0, 4);
  const sorted = [...list].sort(booksLib.byStatus);
  const read = sorted.filter((b) => b.status === 'read');
  /** @type {[string, Book[], boolean][]} title, books, folded */
  const groups = [
    ['Reading', sorted.filter((b) => b.status === 'reading'), false],
    ['Want to read', sorted.filter((b) => b.status === 'want'), false],
    [`Read in ${year}`, read.filter((b) => b.finished?.startsWith(year)), false],
    [`Read before ${year}`, read.filter((b) => !b.finished?.startsWith(year)), true],
    ['Dropped', sorted.filter((b) => b.status === 'dropped'), true],
  ];
  /** @type {HTMLElement[]} */
  const out = [];
  for (const [title, books, folded] of groups) {
    if (!books.length) continue;
    const head = h('h3', {}, title, h('span', { class: 'sub' }, String(books.length)));
    const rows = h('ul', { class: 'rows' }, ...books.map((b) => bookRow(b, { area: areaOf(b) })));
    out.push(folded
      ? h('details', { class: 'group sub-group undated' }, h('summary', {}, head), rows)
      : h('section', { class: 'group sub-group' }, head, rows));
  }
  if (!list.length) out.push(h('p', { class: 'empty small' }, 'No books here yet.'));
  return out;
}

/** Has any of these areas a book? (The Books block shows only where it has.) @param {Set<string>} ids */
export const hasBooks = (ids) => booksStore.current().books.some((b) => b.domain && inAreas(ids, b.domain));

/** The area's name for a book's chip ('' for general reading). @param {Book} b */
export function areaName(b) {
  if (!b.domain) return '';
  const doms = domainsStore.current();
  return domainsLib.label(doms, domainsLib.canonical(doms, b.domain) || b.domain) || b.domain;
}

// ---------------------------------------------------------------- the book's sheet

/** A book's own sheet: status, rating, notes and quotes, each saved as it changes. @param {Book} book */
export function openBook(book) {
  const dialog = /** @type {HTMLDialogElement} */ ($('book-dialog'));
  const today = todayKey();

  const draw = () => {
    const b = booksStore.current().books.find((x) => x.id === book.id);
    if (!b) return dialog.close();
    const edit = canEdit();
    $('book-cover').replaceChildren(cover(b, 'M'));
    $('book-title').textContent = b.title;
    $('book-author').textContent = b.author ?? '';
    const dates = [b.started && `Started ${b.started}`, b.finished && `${b.status === 'dropped' ? 'Dropped' : 'Finished'} ${b.finished}`];
    $('book-dates').textContent = dates.filter(Boolean).join(' · ');

    chipPicker($('book-status'), booksLib.STATUSES.map((s) => /** @type {[string, string]} */ ([s, booksLib.STATUS_TEXT[s]])), b.status, (v) => {
      dispatchBooks({ type: 'status', id: b.id, status: /** @type {Status} */ (v), today });
      draw();
    });
    for (const btn of $('book-status').querySelectorAll('button')) /** @type {HTMLButtonElement} */ (btn).disabled = !edit;

    // Rating: tapping the current number of stars clears it.
    $('book-rating').replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', class: (b.rating ?? 0) >= n ? 'star on' : 'star', disabled: !edit, 'aria-label': `${n} star${n > 1 ? 's' : ''}`,
      'aria-pressed': String(b.rating === n),
      onclick: () => { dispatchBooks({ type: 'edit', id: b.id, fields: { rating: b.rating === n ? null : n } }); draw(); },
    }, '★')));

    const notes = /** @type {HTMLTextAreaElement} */ ($('book-notes'));
    if (document.activeElement !== notes) notes.value = b.notes ?? '';
    notes.disabled = !edit;
    notes.onchange = () => dispatchBooks({ type: 'edit', id: b.id, fields: { notes: notes.value.trim() || null } });

    $('book-quotes').replaceChildren(...b.quotes.map((q) => h(
      'li',
      {},
      h('blockquote', {}, q.text, q.page ? h('span', { class: 'hint' }, ` p. ${q.page}`) : null),
      h('button', { type: 'button', class: 'link danger', disabled: !edit, 'aria-label': 'Remove quote', onclick: () => {
        if (!confirm('Remove this quote?')) return;
        dispatchBooks({ type: 'removeQuote', id: b.id, quoteId: q.id });
        draw();
      } }, 'Remove'),
    )));
    const qForm = /** @type {HTMLFormElement} */ ($('quote-form'));
    for (const el of qForm.querySelectorAll('textarea, input, button')) /** @type {HTMLInputElement} */ (el).disabled = !edit;
    qForm.onsubmit = (ev) => {
      ev.preventDefault();
      const f = /** @type {any} */ (qForm.elements);
      const text = String(f.text.value).trim();
      if (!text) return f.text.focus();
      const p = Number(f.page.value);
      dispatchBooks({ type: 'addQuote', id: b.id, quote: { id: booksLib.newId('q_'), text, page: Number.isInteger(p) && p > 0 ? p : null } });
      qForm.reset();
      draw();
    };

    $('book-extra').replaceChildren(
      h('button', { type: 'button', class: 'btn', disabled: !edit, onclick: () => { dialog.close(); openBookForm('', b); } }, 'Edit'),
    );
  };

  /** @type {HTMLFormElement} */ ($('quote-form')).reset();
  draw();
  dialog.showModal();
}

// ---------------------------------------------------------------- new / edit sheet

/**
 * New book (search Open Library or type it) or edit one's title, author, area and cover.
 * @param {string} [area] area chosen in advance @param {Book} [book]
 */
export function openBookForm(area = '', book) {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('book-form-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('book-form'));
  const f = /** @type {any} */ (form.elements);
  const doms = domainsStore.current();
  const msg = $('book-msg');
  msg.textContent = '';

  $('book-form-title').textContent = book ? 'Edit book' : 'New book';
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!book;
  $('book-submit').textContent = book ? 'Save' : 'Add';
  f.title.value = book?.title ?? '';
  f.author.value = book?.author ?? '';
  f.query.value = '';
  /** @type {{ olid: string|null, cover: number|null }} */
  let picked = { olid: book?.olid ?? null, cover: book?.cover ?? null };
  const showPicked = () => $('book-picked').replaceChildren(
    ...(picked.cover ? [cover(/** @type {any} */ (picked), 'S'), h('span', { class: 'hint' }, 'Cover from Open Library')] : []),
    ...(picked.cover || picked.olid ? [h('button', { type: 'button', class: 'link', onclick: () => { picked = { olid: null, cover: null }; showPicked(); } }, 'Remove')] : []),
  );
  showPicked();
  $('book-results').replaceChildren();

  // An area is optional: without one it is general reading (Books tab and Home only).
  let domain = book ? (book.domain && (domainsLib.canonical(doms, book.domain) || book.domain)) ?? '' : area;
  areaPicker($('book-areas'), doms, domain, (v) => { domain = v; }, { none: 'None' });
  /** @type {Status} */
  let status = 'want';
  $('book-status-pick').hidden = !!book;
  chipPicker($('book-status-new'), [['want', 'Want to read'], ['reading', 'Reading'], ['read', 'Read']], status, (v) => { status = /** @type {Status} */ (v); });

  // Open Library: a result fills in the fields (only the empty ones when editing) and keeps its cover.
  /** @type {AbortController|null} */
  let searching = null;
  const search = async () => {
    const q = String(f.query.value).trim();
    if (!q) return f.query.focus();
    searching?.abort();
    searching = new AbortController();
    const box = $('book-results');
    box.replaceChildren(h('li', { class: 'hint' }, 'Searching…'));
    try {
      const found = await booksLib.search(q, { limit: 8, signal: searching.signal });
      box.replaceChildren(...(found.length ? found.map((r) => h('li', {}, h('button', {
        type: 'button', class: 'result', onclick: () => {
          if (!book || !f.title.value) f.title.value = r.title;
          if (!book || !f.author.value) f.author.value = r.author ?? '';
          picked = { olid: r.olid, cover: r.cover };
          showPicked();
          box.replaceChildren();
        },
      }, cover(r, 'S'), h('span', { class: 'book-text' }, h('span', { class: 'book-title' }, r.title),
        h('span', { class: 'hint' }, [r.author, r.year].filter(Boolean).join(' · ')))))) : [h('li', { class: 'hint' }, 'Nothing found. Type it in below.')]));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      box.replaceChildren(h('li', { class: 'hint' }, 'Could not reach Open Library. Type it in below.'));
    }
  };
  $('book-search').onclick = search;
  f.query.onkeydown = (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    search();
  };

  const extra = $('book-form-extra');
  extra.replaceChildren();
  if (book) {
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      if (!confirm(`Delete “${book.title}” with its notes and quotes permanently?`)) return;
      dispatchBooks({ type: 'delete', id: book.id });
      dialog.close();
    } }, 'Delete…'));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    if (!title) return f.title.focus();
    const fields = { title, author: String(f.author.value).trim() || null, domain: domain || null, olid: picked.olid, cover: picked.cover };
    if (book) dispatchBooks({ type: 'edit', id: book.id, fields });
    else {
      const b = booksLib.newBook(fields);
      dispatchBooks({ type: 'add', book: { ...b, ...booksLib.withStatus(b, status, todayKey()) } });
    }
    dialog.close();
  };

  dialog.showModal();
  if (!book) f.query.focus();
}

// ---------------------------------------------------------------- area page and Home

/** Books of an area (and its sub-areas; those say which one). @param {import('../index.js').AreaScope} scope */
export function areaSections({ id, ids, showSub }) {
  const doms = domainsStore.current();
  const list = booksStore.current().books.filter((b) => b.domain && inAreas(ids, b.domain));
  return bookGroups(list, (b) => {
    const own = domainsLib.canonical(doms, /** @type {string} */ (b.domain)) || b.domain;
    return showSub && own !== id ? domainsLib.find(doms, /** @type {string} */ (own))?.name ?? own : null;
  });
}

/** An area's books on its Home card. @param {import('../index.js').AreaScope} scope */
export const homeCard = ({ ids }) => readingSummary(booksStore.current().books.filter((b) => b.domain && inAreas(ids, b.domain)));

/** The Books card on Home: every book, with or without an area. */
export const booksHomeCard = () => readingSummary(booksStore.current().books);

/**
 * "2 reading · 5 read in 2026" and a line per book being read.
 * @param {Book[]} list
 * @returns {import('../index.js').HomeCard}
 */
function readingSummary(list) {
  const year = todayKey().slice(0, 4);
  const reading = list.filter((b) => b.status === 'reading');
  const read = list.filter((b) => b.status === 'read' && b.finished?.startsWith(year)).length;
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['reading', reading.length], [`read in ${year}`, read]];
  const lines = reading.slice(0, 3).map((b) => h('li', { class: 'mini' }, h('span', { class: 'mini-title' }, b.title), b.author ? h('span', { class: 'hint' }, b.author) : null));
  return { stats, body: lines.length ? [h('ul', { class: 'mini-list' }, ...lines)] : [] };
}
