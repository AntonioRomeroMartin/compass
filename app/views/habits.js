// @ts-check
// Habits: every active habit by area, with today's tick and this week's count; archived ones folded at the end.
import * as domainsLib from '../../lib/domains.js';
import { domainsStore, goalsStore, habitsStore, loaded, state } from '../core/data.js';
import { $, h } from '../core/ui.js';
import { activeHabits, habitRow } from '../modules/habits/view.js';

/** @typedef {import('../../lib/habits.js').Habit} Habit */

/**
 * Habits grouped by area, in the order of the areas.
 * @param {Habit[]} list
 * @returns {[string, Habit[]][]}
 */
export function byArea(list) {
  const doms = domainsStore.current();
  /** @type {Map<string, Habit[]>} */
  const groups = new Map();
  for (const x of list) {
    const k = domainsLib.canonical(doms, x.domain) || x.domain;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const order = (/** @type {string} */ k) => { const i = doms.domains.findIndex((d) => d.id === k); return i < 0 ? 1e5 : i; };
  return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]));
}

export function renderHabitsView() {
  const view = $('view-habits');
  view.replaceChildren();
  if (!state.cfg) return;
  if (!loaded() && !goalsStore.state.fetchedAt) {
    view.append(h('p', { class: 'empty' }, 'Loading…'));
    return;
  }
  const doms = domainsStore.current();
  const active = activeHabits();
  if (!active.length) view.append(h('p', { class: 'empty' }, 'No habits yet. Add one with “+” → Habit.'));
  for (const [area, list] of byArea(active)) {
    view.append(h(
      'section',
      { class: 'group' },
      h('h2', {}, domainsLib.label(doms, area) || area),
      h('ul', { class: 'rows' }, ...list.map((x) => habitRow(x, { freq: true }))),
    ));
  }
  const archived = habitsStore.current().habits.filter((x) => x.archived);
  if (archived.length) {
    view.append(h(
      'details',
      { class: 'group undated' },
      h('summary', {}, h('h2', {}, 'Archived', h('span', { class: 'sub' }, String(archived.length)))),
      h('ul', { class: 'rows' }, ...archived.map((x) => habitRow(x, { area: domainsLib.label(doms, domainsLib.canonical(doms, x.domain) || x.domain) || x.domain, freq: true }))),
    ));
  }
}
