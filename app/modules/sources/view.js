// @ts-check
// Sources module (app side): rows grouped by status (area page and Sources tab, with a filter by kind there), the
// source's own sheet (status, rating, link and file, notes, quotes), the new/edit sheet (kind, Open Library search
// for books), and the area's card on Home.
import * as domainsLib from '../../../lib/domains.js';
import * as sourcesLib from '../../../lib/sources.js';
import { canEdit, dispatchSources, domainsStore, inAreas, sourcesStore, todayKey } from '../../core/data.js';
import { $, areaPicker, chipPicker, h } from '../../core/ui.js';

/** @typedef {import('../../../lib/sources.js').Source} Source */
/** @typedef {import('../../../lib/sources.js').Status} Status */
/** @typedef {import('../../../lib/sources.js').Kind} Kind */

/** A sign for each kind, shown where a book shows its cover. @type {Record<Kind, string>} */
const KIND_ICON = { book: '❐', video: '▶', course: '◆', article: '≡', podcast: '◉' };

/** Who made it, in the words of each kind. @type {Record<Kind, string>} */
const AUTHOR_LABEL = { book: 'Author', video: 'Channel or author', course: 'Teacher or school', article: 'Author or site', podcast: 'Show or host' };

/**
 * The cover of a book from Open Library, or a frame of the same size with the kind's sign.
 * @param {{ kind?: Kind, cover: number|null }} s @param {'S'|'M'|'L'} size
 */
function cover(s, size) {
  const cls = `cover cover-${size.toLowerCase()}`;
  if (!s.cover) return h('span', { class: `${cls} blank`, 'aria-hidden': 'true' }, KIND_ICON[s.kind ?? 'book']);
  return h('img', { class: cls, src: sourcesLib.coverUrl(s.cover, size), alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
}

/** Five stars, the first `n` filled. @param {number} n */
const stars = (n) => h('span', { class: 'stars', 'aria-label': `${n} of 5` }, '★'.repeat(n), h('span', { class: 'off' }, '★'.repeat(5 - n)));

/**
 * A source's row: cover or kind sign, title, kind (unless a book) and author; the stars once rated.
 * @param {Source} s @param {{ area?: string|null }} [show]  also a chip with its area
 */
export function sourceRow(s, show = {}) {
  const sub = [s.kind === 'book' ? null : sourcesLib.KIND_TEXT[s.kind], s.author].filter(Boolean).join(' · ');
  return h(
    'li',
    { class: 'source-row' },
    h(
      'button',
      { class: 'source-open', onclick: () => openSource(s) },
      cover(s, 'S'),
      h(
        'span',
        { class: 'source-text' },
        h('span', { class: 'source-title' }, s.title),
        sub ? h('span', { class: 'hint' }, sub) : null,
      ),
      h(
        'span',
        { class: 'task-meta' },
        show.area ? h('span', { class: 'chip muted' }, show.area) : null,
        s.rating ? stars(s.rating) : null,
      ),
    ),
  );
}

/**
 * Sources grouped by status: in progress, want, done this year; done earlier, dropped and not for me, folded.
 * With one kind, the headings use its words (Reading, Want to read, Read in 2026…).
 * @param {Source[]} list @param {(s: Source) => string|null} [areaOf]  chip with the source's area
 * @param {Kind|''} [kind]  every source is of this kind
 * @returns {HTMLElement[]}
 */
export function sourceGroups(list, areaOf = () => null, kind = '') {
  const year = todayKey().slice(0, 4);
  const words = kind ? sourcesLib.STATUS_TEXT[kind] : sourcesLib.STATUS_ANY;
  const sorted = [...list].sort(sourcesLib.byStatus);
  const done = sorted.filter((s) => s.status === 'done');
  /** @param {Status} st */
  const of = (st) => sorted.filter((s) => s.status === st);
  /** @type {[string, Source[], boolean][]} title, sources, folded */
  const groups = [
    [words.doing, of('doing'), false],
    [words.want, of('want'), false],
    [`${words.done} in ${year}`, done.filter((s) => s.finished?.startsWith(year)), false],
    [`${words.done} before ${year}`, done.filter((s) => !s.finished?.startsWith(year)), true],
    [words.dropped, of('dropped'), true],
    [words.skip, of('skip'), true],
  ];
  /** @type {HTMLElement[]} */
  const out = [];
  for (const [title, items, folded] of groups) {
    if (!items.length) continue;
    const head = h('h3', {}, title, h('span', { class: 'sub' }, String(items.length)));
    const rows = h('ul', { class: 'rows' }, ...items.map((s) => sourceRow(s, { area: areaOf(s) })));
    out.push(folded
      ? h('details', { class: 'group sub-group undated' }, h('summary', {}, head), rows)
      : h('section', { class: 'group sub-group' }, head, rows));
  }
  if (!list.length) out.push(h('p', { class: 'empty small' }, 'No sources here yet.'));
  return out;
}

/** Has any of these areas a source? (The Sources block shows only where it has.) @param {Set<string>} ids */
export const hasSources = (ids) => sourcesStore.current().sources.some((s) => s.domain && inAreas(ids, s.domain));

/** The area's name for a source's chip ('' for one in no area). @param {Source} s */
export function areaName(s) {
  if (!s.domain) return '';
  const doms = domainsStore.current();
  return domainsLib.label(doms, domainsLib.canonical(doms, s.domain) || s.domain) || s.domain;
}

/** The status chips of a kind, in the order they are shown. @param {Kind} kind @param {Status[]} [only] */
const statusItems = (kind, only = [...sourcesLib.STATUSES]) =>
  only.map((st) => /** @type {[string, string]} */ ([st, sourcesLib.STATUS_TEXT[kind][st]]));

// ---------------------------------------------------------------- the source's sheet

/** A source's own sheet: status, rating, notes and quotes, each saved as it changes. @param {Source} source */
export function openSource(source) {
  const dialog = /** @type {HTMLDialogElement} */ ($('source-dialog'));
  const today = todayKey();

  const draw = () => {
    const s = sourcesStore.current().sources.find((x) => x.id === source.id);
    if (!s) return dialog.close();
    const edit = canEdit();
    $('source-cover').replaceChildren(cover(s, 'M'));
    $('source-title').textContent = s.title;
    $('source-author').textContent = [sourcesLib.KIND_TEXT[s.kind], s.author].filter(Boolean).join(' · ');
    const dates = [s.started && `Started ${s.started}`, s.finished && `${s.status === 'dropped' ? 'Dropped' : 'Finished'} ${s.finished}`];
    $('source-dates').textContent = dates.filter(Boolean).join(' · ');
    $('source-where').replaceChildren(
      ...(s.url ? [h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open link ↗')] : []),
      ...(s.file ? [h('span', { class: 'hint' }, `File: sources/${s.file}`)] : []),
    );

    chipPicker($('source-status'), statusItems(s.kind), s.status, (v) => {
      dispatchSources({ type: 'status', id: s.id, status: /** @type {Status} */ (v), today });
      draw();
    });
    for (const btn of $('source-status').querySelectorAll('button')) /** @type {HTMLButtonElement} */ (btn).disabled = !edit;

    // Rating: tapping the current number of stars clears it.
    $('source-rating').replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', class: (s.rating ?? 0) >= n ? 'star on' : 'star', disabled: !edit, 'aria-label': `${n} star${n > 1 ? 's' : ''}`,
      'aria-pressed': String(s.rating === n),
      onclick: () => { dispatchSources({ type: 'edit', id: s.id, fields: { rating: s.rating === n ? null : n } }); draw(); },
    }, '★')));

    const notes = /** @type {HTMLTextAreaElement} */ ($('source-notes'));
    if (document.activeElement !== notes) notes.value = s.notes ?? '';
    notes.disabled = !edit;
    notes.onchange = () => dispatchSources({ type: 'edit', id: s.id, fields: { notes: notes.value.trim() || null } });

    $('source-quotes').replaceChildren(...s.quotes.map((q) => h(
      'li',
      {},
      h('blockquote', {}, q.text, q.page ? h('span', { class: 'hint' }, ` p. ${q.page}`) : null),
      h('button', { type: 'button', class: 'link danger', disabled: !edit, 'aria-label': 'Remove quote', onclick: () => {
        if (!confirm('Remove this quote?')) return;
        dispatchSources({ type: 'removeQuote', id: s.id, quoteId: q.id });
        draw();
      } }, 'Remove'),
    )));
    const qForm = /** @type {HTMLFormElement} */ ($('quote-form'));
    for (const el of qForm.querySelectorAll('textarea, input, button')) /** @type {HTMLInputElement} */ (el).disabled = !edit;
    // Only books and articles have pages.
    /** @type {HTMLInputElement} */ (qForm.elements.namedItem('page')).hidden = s.kind !== 'book' && s.kind !== 'article';
    qForm.onsubmit = (ev) => {
      ev.preventDefault();
      const f = /** @type {any} */ (qForm.elements);
      const text = String(f.text.value).trim();
      if (!text) return f.text.focus();
      const p = Number(f.page.value);
      dispatchSources({ type: 'addQuote', id: s.id, quote: { id: sourcesLib.newId('q_'), text, page: Number.isInteger(p) && p > 0 ? p : null } });
      qForm.reset();
      draw();
    };

    $('source-extra').replaceChildren(
      h('button', { type: 'button', class: 'btn', disabled: !edit, onclick: () => { dialog.close(); openSourceForm('', s); } }, 'Edit'),
    );
  };

  /** @type {HTMLFormElement} */ ($('quote-form')).reset();
  draw();
  dialog.showModal();
}

// ---------------------------------------------------------------- new / edit sheet

/**
 * New source (a book can be searched on Open Library) or edit one's kind, title, author, link, file, area and cover.
 * @param {string} [area] area chosen in advance @param {Source} [source] @param {Kind} [startKind] kind of a new one
 */
export function openSourceForm(area = '', source, startKind = 'book') {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('source-form-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('source-form'));
  const f = /** @type {any} */ (form.elements);
  const doms = domainsStore.current();
  $('source-msg').textContent = '';

  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!source;
  $('source-submit').textContent = source ? 'Save' : 'Add';
  f.title.value = source?.title ?? '';
  f.author.value = source?.author ?? '';
  f.url.value = source?.url ?? '';
  f.file.value = source?.file ?? '';
  f.query.value = '';
  /** @type {{ olid: string|null, cover: number|null }} */
  let picked = { olid: source?.olid ?? null, cover: source?.cover ?? null };
  const showPicked = () => $('source-picked').replaceChildren(
    ...(picked.cover ? [cover(picked, 'S'), h('span', { class: 'hint' }, 'Cover from Open Library')] : []),
    ...(picked.cover || picked.olid ? [h('button', { type: 'button', class: 'link', onclick: () => { picked = { olid: null, cover: null }; showPicked(); } }, 'Remove')] : []),
  );
  $('source-results').replaceChildren();

  /** @type {Kind} */
  let kind = source?.kind ?? startKind;
  /** @type {Status} */
  let status = 'want';
  // The kind changes the words (heading, author, statuses) and whether Open Library is offered.
  const drawKind = () => {
    $('source-form-title').textContent = `${source ? 'Edit' : 'New'} ${sourcesLib.KIND_TEXT[kind].toLowerCase()}`;
    f.author.placeholder = AUTHOR_LABEL[kind];
    f.author.setAttribute('aria-label', AUTHOR_LABEL[kind]);
    $('source-search-row').hidden = kind !== 'book';
    $('source-results').hidden = kind !== 'book';
    $('source-picked').hidden = kind !== 'book';
    showPicked();
    chipPicker($('source-status-new'), statusItems(kind, ['want', 'doing', 'done', 'skip']), status, (v) => { status = /** @type {Status} */ (v); });
  };
  chipPicker($('source-kind'), sourcesLib.KINDS.map((k) => /** @type {[string, string]} */ ([k, sourcesLib.KIND_TEXT[k]])), kind, (v) => {
    kind = /** @type {Kind} */ (v);
    drawKind();
  });
  drawKind();

  // An area is optional: without one it shows only in the Sources tab and on Home.
  let domain = source ? (source.domain && (domainsLib.canonical(doms, source.domain) || source.domain)) ?? '' : area;
  areaPicker($('source-areas'), doms, domain, (v) => { domain = v; }, { none: 'None' });
  $('source-status-pick').hidden = !!source;

  // Open Library: a result fills in the fields (only the empty ones when editing) and keeps its cover.
  /** @type {AbortController|null} */
  let searching = null;
  const search = async () => {
    const q = String(f.query.value).trim();
    if (!q) return f.query.focus();
    searching?.abort();
    searching = new AbortController();
    const box = $('source-results');
    box.replaceChildren(h('li', { class: 'hint' }, 'Searching…'));
    try {
      const found = await sourcesLib.search(q, { limit: 8, signal: searching.signal });
      box.replaceChildren(...(found.length ? found.map((r) => h('li', {}, h('button', {
        type: 'button', class: 'result', onclick: () => {
          if (!source || !f.title.value) f.title.value = r.title;
          if (!source || !f.author.value) f.author.value = r.author ?? '';
          picked = { olid: r.olid, cover: r.cover };
          showPicked();
          box.replaceChildren();
        },
      }, cover(r, 'S'), h('span', { class: 'source-text' }, h('span', { class: 'source-title' }, r.title),
        h('span', { class: 'hint' }, [r.author, r.year].filter(Boolean).join(' · ')))))) : [h('li', { class: 'hint' }, 'Nothing found. Type it in below.')]));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      box.replaceChildren(h('li', { class: 'hint' }, 'Could not reach Open Library. Type it in below.'));
    }
  };
  $('source-search').onclick = search;
  f.query.onkeydown = (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    search();
  };

  const extra = $('source-form-extra');
  extra.replaceChildren();
  if (source) {
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      if (!confirm(`Delete “${source.title}” with its notes and quotes permanently?`)) return;
      dispatchSources({ type: 'delete', id: source.id });
      dialog.close();
    } }, 'Delete…'));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    if (!title) return f.title.focus();
    const book = kind === 'book';
    /** @type {import('../../../lib/sources.js').SourceFields} */
    const fields = {
      kind, title, author: String(f.author.value).trim() || null, url: String(f.url.value).trim() || null,
      file: String(f.file.value).trim().replace(/^sources\//, '') || null, domain: domain || null,
      olid: book ? picked.olid : null, cover: book ? picked.cover : null,
    };
    if (source) dispatchSources({ type: 'edit', id: source.id, fields });
    else {
      const s = sourcesLib.newSource({ ...fields, title });
      dispatchSources({ type: 'add', source: { ...s, ...sourcesLib.withStatus(s, status, todayKey()) } });
    }
    dialog.close();
  };

  dialog.showModal();
  if (!source) (kind === 'book' ? f.query : f.title).focus();
}

// ---------------------------------------------------------------- area page and Home

/** Sources of an area (and its sub-areas; those say which one). @param {import('../index.js').AreaScope} scope */
export function areaSections({ id, ids, showSub }) {
  const doms = domainsStore.current();
  const list = sourcesStore.current().sources.filter((s) => s.domain && inAreas(ids, s.domain));
  return sourceGroups(list, (s) => {
    const own = domainsLib.canonical(doms, /** @type {string} */ (s.domain)) || s.domain;
    return showSub && own !== id ? domainsLib.find(doms, /** @type {string} */ (own))?.name ?? own : null;
  });
}

/** An area's sources on its Home card. @param {import('../index.js').AreaScope} scope */
export const homeCard = ({ ids }) => progressSummary(sourcesStore.current().sources.filter((s) => s.domain && inAreas(ids, s.domain)));

/** The Sources card on Home: every source, with or without an area. */
export const sourcesHomeCard = () => progressSummary(sourcesStore.current().sources);

/**
 * "2 in progress · 5 done in 2026" and a line per source in progress.
 * @param {Source[]} list
 * @returns {import('../index.js').HomeCard}
 */
function progressSummary(list) {
  const year = todayKey().slice(0, 4);
  const doing = list.filter((s) => s.status === 'doing');
  const done = list.filter((s) => s.status === 'done' && s.finished?.startsWith(year)).length;
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['in progress', doing.length], [`done in ${year}`, done]];
  const lines = doing.slice(0, 3).map((s) => h('li', { class: 'mini' }, h('span', { class: 'mini-title' }, s.title),
    h('span', { class: 'hint' }, [s.kind === 'book' ? null : sourcesLib.KIND_TEXT[s.kind], s.author].filter(Boolean).join(' · '))));
  return { stats, body: lines.length ? [h('ul', { class: 'mini-list' }, ...lines)] : [] };
}
