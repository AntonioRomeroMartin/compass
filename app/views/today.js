// @ts-check
// Today: what is due today and this week, by area; undated tasks folded at the end.
import * as domainsLib from '../../lib/domains.js';
import { current, domainsStore, goalsStore, loaded, persist, state, tasksStore, tz } from '../core/data.js';
import { $, h } from '../core/ui.js';
import { goalRow } from '../modules/goals/view.js';
import { taskRow } from '../modules/tasks/view.js';
import { buildToday } from '../../lib/today.js';

/** @typedef {import('../../lib/tasks.js').Task} Task */

export function renderTodayView() {
  const view = $('view-today');
  view.replaceChildren();
  if (!state.cfg) return;
  if (!loaded() && !goalsStore.state.fetchedAt) {
    view.append(h('p', { class: 'empty' }, 'Loading…'));
    return;
  }
  // No Focus block for now (decided 2026-10-23): focus marks set from the CLI are ignored here,
  // so those tasks show in their area like any other.
  const tasksDoc = tasksStore.current();
  const unfocused = { ...tasksDoc, tasks: tasksDoc.tasks.map((x) => ({ ...x, focus: false })) };
  const t = buildToday({ goals: current(), tasks: unfocused, domains: domainsStore.current(), now: new Date(), tz: tz() });
  for (const g of t.groups) {
    view.append(
      h(
        'section',
        { class: 'group' },
        h('h2', {}, g.label),
        h('ul', { class: 'rows' }, ...g.tasks.map((x) => taskRow(x)), ...g.goals.map(goalRow), ...g.ongoing.map((x) => taskRow(x))),
      ),
    );
  }
  // Open tasks without a date, folded at the end, by area.
  const shown = new Set(t.groups.flatMap((g) => [...g.tasks, ...g.ongoing].map((x) => x.id)));
  const undated = tasksDoc.tasks.filter((x) => x.status === 'open' && !x.due && !shown.has(x.id));
  if (!t.groups.length) view.append(h('p', { class: 'empty' }, 'Nothing due in the next 7 days. Add a task with “+”.'));
  if (undated.length) {
    const doms = domainsStore.current();
    /** @type {Map<string, Task[]>} */
    const byArea = new Map();
    for (const x of undated) {
      const k = domainsLib.canonical(doms, x.domain) || x.domain;
      byArea.set(k, [...(byArea.get(k) ?? []), x]);
    }
    const order = (/** @type {string} */ k) => { const i = doms.domains.findIndex((d) => d.id === k); return i < 0 ? 1e5 : i; };
    const details = h(
      'details',
      { class: 'group undated', open: state.undatedOpen },
      h('summary', {}, h('h2', {}, 'No date', h('span', { class: 'sub' }, String(undated.length)))),
      ...[...byArea.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([k, list]) => h(
        'div',
        { class: 'undated-area' },
        h('h3', {}, domainsLib.label(doms, k) || k),
        h('ul', { class: 'rows' }, ...list.map((x) => taskRow(x))),
      )),
    );
    details.addEventListener('toggle', () => { state.undatedOpen = /** @type {HTMLDetailsElement} */ (details).open; persist(); });
    view.append(details);
  }
}
