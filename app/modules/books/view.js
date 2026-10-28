// @ts-check
// Books module (app side): book rows grouped by status (area page and Books tab), the book's own sheet (status,
// page, rating, notes, quotes), the new/edit sheet with the Open Library search, and the area's card on Home.
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

/** A bar with the share read and "p. 60/96" (a book just started is on page 0). @param {Book} b */
function pageBar(b) {
  const page = b.page ?? (b.status === 'reading' ? 0 : null);
  const share = booksLib.progress({ ...b, page });
  if (share === null) return page ? h('span', { class: 'hint' }, `p. ${page}`) : null;
  const fill = h('span');
  fill.style.width = `${Math.round(share * 100)}%`;
  return h('span', { class: 'book-progress' }, h('span', { class: 'bar' }, fill), h('span', { class: 'hint' }, `p. ${page}/${b.pages}`));
}

/**
 * A book's row: small cover, title and author; the page bar while reading, the stars once read.
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
        b.status === 'reading' ? pageBar(b) : null,
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

/** The area a new book goes to when none is chosen: the first that lists the books module. */
export function defaultBookArea() {
  return domainsStore.current().domains.find((d) => d.modules?.includes('books'))?.id ?? '';
}

// ---------------------------------------------------------------- the book's sheet

/** A book's own sheet: status, page, rating, notes and quotes, each saved as it changes. @param {Book} book */
export function openBook(book) {
  const dialog = /** @type {HTMLDialogElement} */ ($('book-dialog'));
  const today = todayKey();

  const draw = () => {
    const b = booksStore.current().books.find((x) => x.id === book.id);
    if (!b) return dialog.close();
    const edit = canEdit();
    $('book-cover').replaceChildren(cover(b, 'M'));
    $('book-title').textContent = b.title;
    $('book-author').textContent = [b.author, b.pages ? `${b.pages} pages` : null].filter(Boolean).join(' · ');
    const dates = [b.started && `Started ${b.started}`, b.finished && `${b.status === 'dropped' ? 'Dropped' : 'Finished'} ${b.finished}`];
    $('book-dates').textContent = dates.filter(Boolean).join(' · ');

    chipPicker($('book-status'), booksLib.STATUSES.map((s) => /** @type {[string, string]} */ ([s, booksLib.STATUS_TEXT[s]])), b.status, (v) => {
      dispatchBooks({ type: 'status', id: b.id, status: /** @type {Status} */ (v), today });
      draw();
    });
    for (const btn of $('book-status').querySelectorAll('button')) /** @type {HTMLButtonElement} */ (btn).disabled = !edit;

    // Page: while reading, and also later if it was set.
    const pageBox = $('book-page-box');
    pageBox.hidden = b.status !== 'reading' && b.page === null;
    const page = /** @type {HTMLInputElement} */ ($('book-page'));
    page.value = b.page === null ? '' : String(b.page);
    page.max = b.pages ? String(b.pages) : '';
    page.disabled = !edit;
    page.onchange = () => {
      const n = page.value === '' ? null : Math.max(0, Math.min(Number(page.value), b.pages ?? Infinity));
      if (n !== null && !Number.isInteger(n)) return;
      dispatchBooks({ type: 'edit', id: b.id, fields: { page: n } });
      draw();
    };
    $('book-of').textContent = b.pages ? `of ${b.pages}` : '';
    $('book-page-bar').replaceChildren(...[pageBar(b)].filter((x) => x !== null));

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
 * New book (search Open Library or type it) or edit one's title, author, pages, area and cover.
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
  f.pages.value = book?.pages ?? '';
  f.query.value = '';
  /** @type {{ olid: string|null, cover: number|null }} */
  let picked = { olid: book?.olid ?? null, cover: book?.cover ?? null };
  const showPicked = () => $('book-picked').replaceChildren(
    ...(picked.cover ? [cover(/** @type {any} */ (picked), 'S'), h('span', { class: 'hint' }, 'Cover from Open Library')] : []),
    ...(picked.cover || picked.olid ? [h('button', { type: 'button', class: 'link', onclick: () => { picked = { olid: null, cover: null }; showPicked(); } }, 'Remove')] : []),
  );
  showPicked();
  $('book-results').replaceChildren();

  // Only the areas with the books module (and their sub-areas).
  const withBooks = { ...doms, domains: doms.domains.filter((d) => domainsLib.modulesOf(doms, d.id).includes('books')) };
  let domain = book ? domainsLib.canonical(doms, book.domain) || book.domain : area || defaultBookArea();
  areaPicker($('book-areas'), withBooks, domain, (v) => { domain = v; });
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
          if (!book || !f.pages.value) f.pages.value = r.pages ?? '';
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
    if (!domain) { msg.textContent = 'Choose an area.'; return; }
    const pages = Number(f.pages.value);
    const fields = {
      title, author: String(f.author.value).trim() || null, domain,
      pages: Number.isInteger(pages) && pages > 0 ? pages : null, olid: picked.olid, cover: picked.cover,
    };
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
  const list = booksStore.current().books.filter((b) => inAreas(ids, b.domain));
  return bookGroups(list, (b) => {
    const own = domainsLib.canonical(doms, b.domain) || b.domain;
    return showSub && own !== id ? domainsLib.find(doms, own)?.name ?? own : null;
  });
}

/** "2 reading · 5 read in 2026" and a line per book being read, with its page bar. @param {import('../index.js').AreaScope} scope */
export function homeCard({ ids }) {
  const list = booksStore.current().books.filter((b) => inAreas(ids, b.domain));
  const year = todayKey().slice(0, 4);
  const reading = list.filter((b) => b.status === 'reading');
  const read = list.filter((b) => b.status === 'read' && b.finished?.startsWith(year)).length;
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['reading', reading.length], [`read in ${year}`, read]];
  const lines = reading.slice(0, 3).map((b) => {
    const share = booksLib.progress({ ...b, page: b.page ?? 0 });
    const fill = h('span');
    if (share !== null) fill.style.width = `${Math.round(share * 100)}%`;
    return h(
      'li',
      { class: 'mini goal-bar' },
      h('span', { class: 'mini-title' }, b.title),
      share !== null ? h('span', { class: 'count' }, `${Math.round(share * 100)}%`) : null,
      share !== null ? h('div', { class: 'bar' }, fill) : null,
    );
  });
  return { stats, body: lines.length ? [h('ul', { class: 'mini-list' }, ...lines)] : [] };
}
