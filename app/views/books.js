// @ts-check
// Books: every book, grouped by status (Reading, Want to read, Read this year…), with "+ Book" at the top.
import * as domainsLib from '../../lib/domains.js';
import { booksStore, canEdit, domainsStore, goalsStore, loaded, state } from '../core/data.js';
import { $, h } from '../core/ui.js';
import { bookGroups, openBookForm } from '../modules/books/view.js';

export function renderBooksView() {
  const view = $('view-books');
  view.replaceChildren();
  if (!state.cfg) return;
  if (!loaded() && !goalsStore.state.fetchedAt) {
    view.append(h('p', { class: 'empty' }, 'Loading…'));
    return;
  }
  const doms = domainsStore.current();
  const list = booksStore.current().books;
  // The area of each book is shown only when the books are spread over several areas.
  const areas = new Set(list.map((b) => domainsLib.canonical(doms, b.domain) || b.domain));
  view.append(h('div', { class: 'block-head' }, h('span'), h('button', { class: 'btn small', disabled: !canEdit(), onclick: () => openBookForm() }, '+ Book')));
  view.append(...bookGroups(list, areas.size > 1 ? (b) => domainsLib.label(doms, domainsLib.canonical(doms, b.domain) || b.domain) || b.domain : undefined));
}
