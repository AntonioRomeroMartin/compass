// @ts-check
// Home: one card per area with what each of its modules has to say (figures and a few lines); a card opens its area.
// After them, the Books card (every book, with or without an area), which opens the Books tab.

import * as domainsLib from '../../lib/domains.js';
import { areaIds, domainsStore, goalsStore, loaded, persist, render, state } from '../core/data.js';
import { $, h } from '../core/ui.js';
import { modulesOf } from '../modules/index.js';
import { openArea } from './areas.js';
import { booksHomeCard } from '../modules/books/view.js';

/** @param {string} title @param {import('../modules/index.js').HomeCard[]} parts @param {() => void} open @param {HTMLElement|null} [foot] */
function card(title, parts, open, foot = null) {
  const stats = parts.flatMap((p) => p.stats);
  const body = parts.flatMap((p) => p.body);
  return h(
    'button',
    { class: 'home-card', onclick: open },
    h('div', { class: 'home-card-head' }, h('span', { class: 'area-name' }, title), h('span', { class: 'count' }, '›')),
    h('div', { class: 'stats' }, ...stats.map(([label, value, tone]) => h(
      'span',
      { class: `stat${tone && value ? ` ${tone}` : ''}` },
      h('b', {}, String(value)), ` ${label}`,
    ))),
    ...body,
    foot,
  );
}

export function renderHome() {
  const view = $('view-home');
  view.replaceChildren();
  if (!state.cfg) return;
  const doms = domainsStore.current();
  if (!doms.domains.length) {
    view.append(h('p', { class: 'empty' }, loaded() || goalsStore.state.fetchedAt ? 'No areas yet.' : 'Loading…'));
    return;
  }
  const cards = doms.domains.filter((d) => !d.parent).map((d) => {
    const scope = { id: d.id, ids: areaIds(d.id), showSub: true };
    const kids = domainsLib.children(doms, d.id);
    return card(d.name, modulesOf(d.id).map((m) => m.homeCard(scope)), () => openArea(d.id),
      kids.length ? h('div', { class: 'chips' }, ...kids.map((k) => h('span', { class: 'chip muted' }, k.name))) : null);
  });
  const books = card('Books', [booksHomeCard()], () => { state.tab = 'books'; persist(); render(); window.scrollTo(0, 0); });
  view.append(h('div', { class: 'home-grid' }, ...cards, books));
}
