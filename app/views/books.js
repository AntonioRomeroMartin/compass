// @ts-check
// Books: every book, with or without an area, grouped by status (Reading, Want to read, Read this year…).
import { booksStore, canEdit, goalsStore, loaded, state } from '../core/data.js';
import { $, h } from '../core/ui.js';
import { areaName, bookGroups, openBookForm } from '../modules/books/view.js';

export function renderBooksView() {
  const view = $('view-books');
  view.replaceChildren();
  if (!state.cfg) return;
  if (!loaded() && !goalsStore.state.fetchedAt) {
    view.append(h('p', { class: 'empty' }, 'Loading…'));
    return;
  }
  view.append(h('div', { class: 'block-head' }, h('span'), h('button', { class: 'btn small', disabled: !canEdit(), onclick: () => openBookForm() }, '+ Book')));
  // Books with an area carry its name; general reading carries none.
  view.append(...bookGroups(booksStore.current().books, (b) => areaName(b) || null));
}
