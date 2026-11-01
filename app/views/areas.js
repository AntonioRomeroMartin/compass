// @ts-check
// Areas: the list (and its edit mode: add, rename, reorder by dragging, delete), the sidebar tree and the page of one
// area (built from its modules).
import * as domainsLib from '../../lib/domains.js';
import { areaIds, booksStore, canEdit, current, dispatchDomains, domainsStore, habitsStore, persist, render, state, tasksStore, tz } from '../core/data.js';
import { $, chipPicker, h } from '../core/ui.js';
import { modulesOf } from '../modules/index.js';
import { isExpired } from '../../lib/goals.js';

export function renderAreas() {
  const view = $('view-areas');
  view.replaceChildren();
  if (!state.cfg) return;
  const doms = domainsStore.current();
  if (state.area && !domainsLib.find(doms, state.area)) state.area = '';
  if (state.area) return renderArea(view, state.area);
  $('page-title').textContent = 'Areas';
  const edit = canEdit();
  if (!edit) state.areasEdit = false;
  view.append(h('div', { class: 'area-bar' }, h('span'), edit ? h('button', {
    class: 'btn small',
    'aria-pressed': String(state.areasEdit),
    onclick: () => { state.areasEdit = !state.areasEdit; render(); },
  }, state.areasEdit ? 'Done' : 'Edit') : null));
  if (state.areasEdit) return renderEditList(view);
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

/**
 * Edit mode: each area with a drag handle, its name (saved when you leave the field) and a delete button (only for
 * an empty one, as in the CLI); sub-areas below their area. A "+" adds an area or a sub-area.
 * @param {HTMLElement} view
 */
function renderEditList(view) {
  const doms = domainsStore.current();
  /** @param {string} id */
  const used = (id) => domainsLib.usage(doms, id, {
    tasks: tasksStore.current().tasks.map((t) => t.domain),
    goals: current().goals.map((g) => g.category),
    habits: habitsStore.current().habits.map((x) => x.domain),
    books: booksStore.current().books.map((b) => b.domain),
  });
  /** @param {import('../../lib/domains.js').Domain} d */
  const row = (d) => {
    const kids = domainsLib.children(doms, d.id);
    const name = h('input', { value: d.name, maxlength: 60, 'aria-label': `Name of ${d.name}`, autocomplete: 'off' });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v) name.value = d.name;
      else if (v !== d.name) dispatchDomains({ type: 'edit', id: d.id, fields: { name: v } });
    });
    const inUse = used(d.id);
    const why = kids.length ? 'Has sub-areas: delete or move them first'
      : inUse.length ? `Still used by ${inUse.map(([what, n]) => `${n} ${what}`).join(', ')}` : '';
    const del = h('button', {
      class: 'icon danger', disabled: !!why, title: why || `Delete ${d.name}`, 'aria-label': `Delete ${d.name}`,
      onclick: () => { if (confirm(`Delete the area “${d.name}”?`)) dispatchDomains({ type: 'delete', id: d.id }); },
    }, '🗑');
    const handle = h('span', { class: 'drag', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⠿');
    const li = h('li', { 'data-id': d.id },
      h('div', { class: 'edit-row' }, handle, name, del),
      kids.length ? h('ul', { class: 'edit-list sub' }, ...kids.map(row)) : null,
      d.parent ? null : adding === d.id ? newAreaField(d.id) : h('button', { class: 'link add-sub', onclick: () => startAdding(d.id) }, '+ Sub-area'));
    dragToReorder(handle, li);
    return li;
  };
  view.append(
    h('ul', { class: 'edit-list' }, ...doms.domains.filter((d) => !d.parent).map(row)),
    adding === '' ? newAreaField('') : h('button', { class: 'btn add-area', onclick: () => startAdding('') }, '+ New area'),
    h('p', { class: 'hint' }, 'Drag ⠿ to reorder. Renaming keeps everything in the area.'),
  );
}

/** Where a new area is being typed: '' at the top level, an area's id for a sub-area of it, null nowhere. @type {string|null} */
let adding = null;

/** @param {string} parent */
function startAdding(parent) {
  adding = parent;
  render();
  document.getElementById('area-new')?.focus();
}

/** The name field of a new area (or sub-area of `parent`): Enter adds it, Escape or leaving it empty cancels. @param {string} parent */
function newAreaField(parent) {
  const under = parent ? domainsLib.find(domainsStore.current(), parent)?.name : null;
  const input = h('input', { id: 'area-new', class: 'new-area', maxlength: 60, autocomplete: 'off', placeholder: under ? `New sub-area of ${under}` : 'New area name', 'aria-label': 'Name of the new area' });
  const close = () => { adding = null; render(); };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') return close();
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    const name = input.value.trim();
    if (!name) return close();
    adding = null;
    const doms = domainsStore.current();
    dispatchDomains({ type: 'add', domain: { id: domainsLib.newId(doms, name, parent || undefined), name, ...(parent ? { parent } : {}) } });
  });
  input.addEventListener('blur', () => { if (!input.value.trim()) setTimeout(close, 0); });
  return input;
}

/**
 * Drag a row by its handle among its siblings (mouse or touch); on release, saves where it ended.
 * @param {HTMLElement} handle @param {HTMLElement} li
 */
function dragToReorder(handle, li) {
  handle.addEventListener('pointerdown', (down) => {
    const list = /** @type {HTMLElement} */ (li.parentElement);
    const start = [...list.children].indexOf(li);
    down.preventDefault();
    li.classList.add('dragging');
    // Listened on the window: moving the row in the page would lose a capture on the handle.
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      if (ev.pointerId !== down.pointerId) return;
      for (const other of /** @type {HTMLElement[]} */ ([...list.children])) {
        if (other === li) continue;
        const r = other.getBoundingClientRect();
        if (ev.clientY > r.top && ev.clientY < r.bottom) {
          list.insertBefore(li, ev.clientY < r.top + r.height / 2 ? other : other.nextSibling);
          break;
        }
      }
    };
    /** @param {PointerEvent} ev */
    const up = (ev) => {
      if (ev.pointerId !== down.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      const next = /** @type {HTMLElement|null} */ (li.nextElementSibling);
      if ([...list.children].indexOf(li) !== start) {
        dispatchDomains({ type: 'move', id: /** @type {string} */ (li.dataset.id), before: next?.dataset.id ?? null });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
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

/** Page of one area: the sub-area filter, then one block per module (Tasks, Goals…), each with its "+". @param {HTMLElement} view @param {string} id */
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
  for (const m of modulesOf(id)) {
    view.append(h(
      'section',
      { class: 'module-block' },
      h('div', { class: 'block-head' }, h('h2', {}, m.title), m.add ? h('button', { class: 'btn small', disabled: !canEdit(), onclick: () => m.add?.(scopeId) }, `+ ${m.addLabel}`) : null),
      ...m.areaSections(scope),
    ));
  }
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
