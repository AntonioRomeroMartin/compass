// @ts-check
// Areas: the list, the sidebar tree and the page of one area (built from its modules).
import * as domainsLib from '../../lib/domains.js';
import { areaIds, canEdit, current, domainsStore, persist, render, state, tasksStore, tz } from '../core/data.js';
import { $, chipPicker, h } from '../core/ui.js';
import { modulesOf } from '../modules/index.js';
import { openTaskForm } from '../modules/tasks/view.js';
import { isExpired } from '../../lib/goals.js';

export function renderAreas() {
  const view = $('view-areas');
  view.replaceChildren();
  if (!state.cfg) return;
  const doms = domainsStore.current();
  if (state.area && !domainsLib.find(doms, state.area)) state.area = '';
  if (state.area) return renderArea(view, state.area);
  $('page-title').textContent = 'Areas';
  const open = tasksStore.current().tasks.filter((t) => t.status === 'open');
  const now = new Date();
  const live = current().goals.filter((g) => !g.archived && !isExpired(g, now, tz()));
  if (!doms.domains.length) {
    view.append(h('p', { class: 'empty' }, domainsStore.state.loaded ? 'No areas yet.' : 'Loading…'));
    return;
  }
  /** @param {string} id */
  const counts = (id) => {
    const ids = areaIds(id);
    return {
      tasks: open.filter((t) => ids.has(domainsLib.canonical(doms, t.domain))).length,
      goals: live.filter((g) => ids.has(domainsLib.canonical(doms, g.category))).length,
    };
  };
  const top = doms.domains.filter((d) => !d.parent);
  view.append(
    h(
      'ul',
      { class: 'areas' },
      ...top.map((d) => {
        const c = counts(d.id);
        const kids = domainsLib.children(doms, d.id);
        return h(
          'li',
          {},
          h(
            'button',
            { class: 'area', onclick: () => openArea(d.id) },
            h('div', { class: 'area-head' }, h('span', { class: 'area-name' }, d.name), h('span', { class: 'count' }, `${c.tasks} tasks · ${c.goals} goals ›`)),
            kids.length ? h('div', { class: 'chips' }, ...kids.map((k) => h('span', { class: 'chip muted' }, k.name))) : null,
          ),
        );
      }),
    ),
  );
}

/** @param {string} id */
export function openArea(id) {
  const d = id ? domainsLib.find(domainsStore.current(), id) : null;
  // A sub-area opens its parent's page with the filter on it.
  state.area = d?.parent ? d.parent : id;
  state.subArea = d?.parent ? id : '';
  state.tab = 'areas';
  persist();
  render();
  window.scrollTo(0, 0);
}

/** Page of one area: "+ Task", the sub-area filter, then the sections of each of its modules. @param {HTMLElement} view @param {string} id */
export function renderArea(view, id) {
  const doms = domainsStore.current();
  const area = /** @type {import('../../lib/domains.js').Domain} */ (domainsLib.find(doms, id));
  $('page-title').textContent = area.name;
  const kids = domainsLib.children(doms, id);
  const scopeId = state.subArea && kids.some((k) => k.id === state.subArea) ? state.subArea : id;
  view.append(
    h(
      'div',
      { class: 'area-bar' },
      h('button', { class: 'link back', onclick: () => openArea('') }, '‹ Areas'),
      h('button', { class: 'btn primary', disabled: !canEdit(), onclick: () => openTaskForm(undefined, scopeId) }, '+ Task'),
    ),
  );
  if (kids.length) {
    const box = h('div', { class: 'chip-pick sub-filter', role: 'radiogroup', 'aria-label': 'Sub-area' });
    chipPicker(box, [[id, 'All'], ...kids.map((k) => /** @type {[string, string]} */ ([k.id, k.name]))], scopeId, (v) => {
      state.subArea = v === id ? '' : v;
      persist();
      render();
    });
    view.append(box);
  }
  const scope = { id: scopeId, ids: areaIds(scopeId), showSub: scopeId === id && kids.length > 0 };
  for (const m of modulesOf(id)) view.append(...m.areaSections(scope));
}

/** Sidebar (wide screens): the areas tree under "Areas", closed by default; an area's name folds its sub-areas. */
export function renderNavAreas() {
  const box = $('nav-areas');
  const doms = domainsStore.current();
  box.hidden = !state.navOpen || !doms.domains.length;
  if (box.hidden) return;
  /** @type {HTMLElement[]} */
  const items = [];
  /** @param {string} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const d of doms.domains.filter((x) => (x.parent ?? '') === parent)) {
      const kids = domainsLib.children(doms, d.id).length > 0;
      const open = state.navExpanded.includes(d.id);
      const here = state.tab === 'areas' && (state.subArea ? state.subArea === d.id : state.area === d.id);
      // The name opens the area and, if it has sub-areas, unfolds or folds them.
      const name = h('button', {
        class: 'nav-area-name',
        'aria-expanded': kids ? String(open) : null,
        onclick: () => {
          if (kids) state.navExpanded = open ? state.navExpanded.filter((x) => x !== d.id) : [...state.navExpanded, d.id];
          openArea(d.id);
        },
      }, d.name);
      if (here) name.setAttribute('aria-current', 'page');
      items.push(h('div', { class: 'nav-area', style: `--depth: ${depth}` }, name));
      if (kids && open) walk(d.id, depth + 1);
    }
  };
  walk('', 0);
  box.replaceChildren(...items);
}
