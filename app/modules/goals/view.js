// @ts-check
// Goals module (app side): the Goals page, goal cards and sheet, categories, and its parts of the area page and the Home card.
import * as domainsLib from '../../../lib/domains.js';
import { areaIds, canEdit, current, dispatchGoals, domainsStore, goalsStore, inAreas, state, tz } from '../../core/data.js';
import { $, editRow, fmt, h } from '../../core/ui.js';
import { categoryUsage, goalKey, isDone, isExpired, newId, subgoalsDone } from '../../../lib/goals.js';
import { HORIZONS, daysUntil, deviceTimeZone, isValidTimeZone, periodKey } from '../../../lib/period.js';

/** @typedef {import('../../../lib/goals.js').Goal} Goal */
/** @typedef {import('../../../lib/goals.js').Op} Op */
/** @typedef {import('../../../lib/period.js').Horizon} Horizon */

/** @type {Record<Horizon, string>} */
// A goal's category is an area (domain id or name, see lib/domains.js). Labels that match no area keep
// working as they are, so goals created before the areas existed still show up.

/** Area id of a goal's category, or the text itself when it matches no area. @param {string} category */
const areaOf = (category) => domainsLib.canonical(domainsStore.current(), category) || category;

/** "University › AM" for an area id; the text itself otherwise. @param {string} category */
export const categoryLabel = (category) => domainsLib.label(domainsStore.current(), areaOf(category)) || category;

/** Choices for a category: the areas (sub-areas indented), then labels in use that match no area. @returns {[string, string][]} */
function categoryOptions() {
  const doms = domainsStore.current();
  /** @type {[string, string][]} */
  const out = [];
  /** @param {string} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const d of doms.domains.filter((x) => (x.parent ?? '') === parent)) {
      out.push([d.id, `${'\u2003'.repeat(depth)}${d.name}`]);
      walk(d.id, depth + 1);
    }
  };
  walk('', 0);
  const known = new Set(out.map(([id]) => id));
  const doc = current();
  for (const c of [...doc.categories, ...doc.goals.map((g) => g.category)]) {
    if (c && !known.has(areaOf(c))) { out.push([c, c]); known.add(c); }
  }
  return out;
}

/** Does a goal fall in the area chosen in the filter (its sub-areas included)? @param {Goal} g @param {string} filter */
const inFilter = (g, filter) => !filter || (domainsLib.find(domainsStore.current(), filter) ? inAreas(areaIds(filter), g.category) : g.category === filter);

export const HORIZON_LABEL = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  deadline: 'With deadline',
};

/** @type {Record<Horizon, string>} */
export const HORIZON_SHORT = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
  deadline: 'Deadline',
};

/** Compact goal row for Today: title, progress and +1. @param {Goal} g */
export function goalRow(g) {
  const key = goalKey(g, new Date(), tz());
  const value = g.progress[key] ?? 0;
  const target = g.target && g.target > 0 ? g.target : null;
  const done = isDone(g, key);
  return h(
    'li',
    { class: done ? 'task goal done' : 'task goal' },
    h('span', { class: 'goal-mark', 'aria-hidden': 'true' }, done ? '◆' : '◇'),
    h('span', { class: 'task-title' }, g.title),
    h(
      'span',
      { class: 'task-meta' },
      h('span', { class: 'chip muted' }, `${fmt(value)}${target ? ` / ${fmt(target)}` : ''}${g.unit ? ` ${g.unit}` : ''}`),
      h('button', {
        class: 'round small', 'aria-label': `Add 1 to ${g.title}`, disabled: !canEdit(),
        onclick: () => dispatchGoals(target ? { type: 'inc', id: g.id, key, delta: 1 } : { type: 'set', id: g.id, key, value: done ? 0 : 1 }),
      }, target ? '+' : done ? '✓' : '○'),
    ),
  );
}

export function renderToolbar() {
  const doc = current();
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (btn).dataset.view === state.view));
  }
  const select = /** @type {HTMLSelectElement} */ ($('filter'));
  const options = categoryOptions();
  select.replaceChildren(
    h('option', { value: '' }, 'All areas'),
    ...options.map(([v, text]) => h('option', { value: v }, text)),
  );
  if (state.filter && !options.some(([v]) => v === state.filter)) state.filter = '';
  select.value = state.filter;
  /** @type {HTMLSelectElement} */ ($('scope')).value = state.scope;
}

export function renderList() {
  const main = $('list');
  main.replaceChildren();
  const doc = current();
  const now = new Date();
  const zone = tz();
  const inScope = (/** @type {Goal} */ g) =>
    state.scope === 'archived' ? !!g.archived
      : state.scope === 'past' ? !g.archived && isExpired(g, now, zone)
      : !g.archived && !isExpired(g, now, zone);
  const goals = doc.goals.filter((g) => inScope(g) && inFilter(g, state.filter));

  if (!goalsStore.state.loaded && !goalsStore.state.fetchedAt) {
    main.append(h('p', { class: 'empty' }, state.cfg ? 'Loading goals…' : 'No data yet.'));
    return;
  }
  if (!goals.length) {
    const msg = state.scope === 'archived'
      ? 'No archived goals.'
      : state.scope === 'past'
        ? 'No past goals yet. Goals move here when their period or deadline ends.'
        : doc.goals.length ? 'No goals here yet.' : 'You have no goals yet. Create your first one with “+ New”.';
    main.append(h('p', { class: 'empty' }, msg));
    return;
  }

  /** @type {[string, string, Goal[]][]} */
  const groups = [];
  if (state.scope === 'past') {
    const end = (/** @type {Goal} */ g) => (g.horizon === 'deadline' ? g.deadline ?? '' : g.createdAt);
    goals.sort((a, b) => end(b).localeCompare(end(a)));
    const done = goals.filter((g) => isDone(g, goalKey(g, now, zone))).length;
    groups.push(['Past', `${done} of ${goals.length} completed (${Math.round((done / goals.length) * 100)}%)`, goals]);
  } else if (state.view === 'horizon') {
    for (const hz of HORIZONS) {
      const list = goals.filter((g) => g.horizon === hz);
      if (!list.length) continue;
      const sub = hz === 'deadline' ? '' : periodKey(hz, now, zone);
      if (hz === 'deadline') list.sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
      groups.push([HORIZON_LABEL[hz], sub, list]);
    }
  } else {
    for (const [cat] of categoryOptions()) {
      const list = goals.filter((g) => areaOf(g.category) === cat);
      if (!list.length) continue;
      list.sort((a, b) => HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon));
      groups.push([categoryLabel(cat), '', list]);
    }
  }

  for (const [title, sub, list] of groups) {
    main.append(
      h(
        'section',
        { class: 'group' },
        h('h2', {}, title, sub ? h('span', { class: 'sub' }, sub) : null),
        h('ul', { class: 'cards' }, ...list.map((g) => h('li', {}, card(g, now)))),
      ),
    );
  }
}

/** @param {Goal} g @param {Date} now */
export function card(g, now) {
  const zone = tz();
  const key = goalKey(g, now, zone);
  const value = g.progress[key] ?? 0;
  const expired = isExpired(g, now, zone);
  const editable = canEdit() && !g.archived && !expired;
  const target = g.target && g.target > 0 ? g.target : null;
  const done = isDone(g, key);
  const when = g.horizon === 'deadline' ? 'Deadline' : expired ? HORIZON_SHORT[g.horizon] : HORIZON_LABEL[g.horizon];

  const chips = h(
    'div',
    { class: 'chips' },
    // Active: the view already groups by horizon or category, so the other one is shown.
    // Past and archived: single list, both are shown.
    state.scope !== 'active' || state.view === 'horizon' ? h('span', { class: 'chip' }, categoryLabel(g.category)) : null,
    state.scope !== 'active' || state.view === 'category' ? h('span', { class: 'chip muted' }, when) : null,
    expired ? h('span', { class: 'chip muted' }, g.horizon === 'deadline' ? g.deadline ?? '' : key) : null,
    expired ? h('span', { class: done ? 'chip' : 'chip danger' }, done ? '✓ Completed' : '✗ Missed') : null,
    g.horizon === 'deadline' && g.deadline && !expired ? deadlineChip(g.deadline, now) : null,
    g.repo ? h('span', { class: 'chip muted' }, g.repo) : null,
    g.location ? h('span', { class: 'chip muted' }, `📍 ${g.location}`) : null,
  );

  /** @type {HTMLElement} */
  let progress;
  if (g.archived) {
    progress = h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', disabled: !canEdit(), onclick: () => dispatchGoals({ type: 'archive', id: g.id, archived: false }) }, 'Restore'),
    );
  } else if (expired) {
    progress = h('p', { class: 'result' }, target ? `${fmt(value)} / ${fmt(target)}${g.unit ? ` ${g.unit}` : ''}` : done ? 'Done' : 'Not done');
  } else if (target) {
    const pct = Math.min(100, (value / target) * 100);
    const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': target, 'aria-valuenow': value });
    const fill = h('span');
    fill.style.width = `${pct}%`;
    bar.append(fill);
    progress = h(
      'div',
      { class: 'progress' },
      bar,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'round', 'aria-label': 'Decrease', disabled: !editable || value <= 0, onclick: () => dispatchGoals({ type: 'inc', id: g.id, key, delta: -1 }) }, '−'),
        h(
          'button',
          { class: 'value', disabled: !editable, title: 'Enter exact value', onclick: () => askValue(g, key, value) },
          `${fmt(value)} / ${fmt(target)}${g.unit ? ` ${g.unit}` : ''}`,
        ),
        h('button', { class: 'round', 'aria-label': 'Increase', disabled: !editable, onclick: () => dispatchGoals({ type: 'inc', id: g.id, key, delta: 1 }) }, '+'),
      ),
    );
  } else {
    progress = h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: done ? 'btn done' : 'btn',
          'aria-pressed': String(done),
          disabled: !editable,
          onclick: () => dispatchGoals({ type: 'set', id: g.id, key, value: done ? 0 : 1 }),
        },
        done ? '✓ Done' : 'Mark as done',
      ),
    );
  }

  return h(
    'article',
    { class: done && !g.archived && !expired ? 'card is-done' : 'card' },
    h('button', { class: 'title', disabled: !canEdit(), onclick: () => openGoalForm(g) }, g.title),
    chips,
    g.notes ? h('p', { class: 'notes' }, g.notes) : null,
    g.subgoals?.length ? subgoalList(g, key, editable) : null,
    progress,
  );
}

/** Checkboxes of the sub-goals. @param {Goal} g @param {string} key @param {boolean} editable */
export function subgoalList(g, key, editable) {
  const subs = g.subgoals ?? [];
  return h(
    'div',
    { class: 'subs' },
    h('p', { class: 'subs-count' }, `Sub-goals · ${subgoalsDone(g, key)} of ${subs.length}`),
    h(
      'ul',
      {},
      ...subs.map((s) => {
        const done = s.done.includes(key);
        return h(
          'li',
          {},
          h(
            'label',
            { class: done ? 'sub done' : 'sub' },
            h('input', { type: 'checkbox', checked: done, disabled: !editable, onchange: () => dispatchGoals({ type: 'toggleSub', id: g.id, subId: s.id, key, done: !done }) }),
            h('span', {}, s.title),
          ),
        );
      }),
    ),
  );
}

/** @param {string} deadline @param {Date} now */
export function deadlineChip(deadline, now) {
  const d = daysUntil(deadline, now, tz());
  const text = d > 1 ? `${d} days left` : d === 1 ? 'tomorrow' : d === 0 ? 'today' : `overdue by ${-d} ${d === -1 ? 'day' : 'days'}`;
  return h('span', { class: d < 0 ? 'chip danger' : d <= 7 ? 'chip warn' : 'chip' }, `${deadline} · ${text}`);
}

/** @param {Goal} g @param {string} key @param {number} value */
export function askValue(g, key, value) {
  const input = prompt(`Value for “${g.title}” (${key})`, String(value));
  if (input === null) return;
  const n = Number(input.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return alert('Enter a number greater than or equal to 0.');
  dispatchGoals({ type: 'set', id: g.id, key, value: n });
}

export const NEW_CATEGORY = '__new__';

/** @param {Goal} [goal] @param {string} [area] area chosen in advance (e.g. from an area's page) */
export function openGoalForm(goal, area = '') {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('goal-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('goal-form'));
  const doc = current();
  const f = /** @type {any} */ (form.elements);

  $('goal-dialog-title').textContent = goal ? 'Edit goal' : 'New goal';
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!goal;
  f.title.value = goal?.title ?? '';
  const options = categoryOptions();
  f.category.replaceChildren(
    ...options.map(([v, text]) => h('option', { value: v }, text)),
    h('option', { value: NEW_CATEGORY }, '+ Other label…'),
  );
  f.category.value = goal ? areaOf(goal.category) : area || state.filter || options[0]?.[0] || NEW_CATEGORY;
  f.newCategory.value = '';
  f.horizon.value = goal?.horizon ?? 'week';
  f.target.value = goal?.target ?? '';
  f.unit.value = goal?.unit ?? '';
  f.deadline.value = goal?.deadline ?? '';
  f.repo.value = goal?.repo ?? '';
  f.location.value = goal?.location ?? '';
  f.notes.value = goal?.notes ?? '';
  const subList = $('subgoal-list');
  subList.replaceChildren(...(goal?.subgoals ?? []).map((s) => subgoalRow(s.id, s.title)));
  $('add-subgoal').onclick = () => {
    const row = subgoalRow('', '');
    subList.append(row);
    /** @type {HTMLInputElement} */ (row.querySelector('input')).focus();
  };
  syncFormVisibility(form);

  const actions = $('goal-extra-actions');
  actions.replaceChildren();
  if (goal) {
    actions.append(
      h('button', { type: 'button', class: 'btn', onclick: () => { dispatchGoals({ type: 'archive', id: goal.id, archived: !goal.archived }); dialog.close(); } }, goal.archived ? 'Restore' : 'Archive'),
      h('button', { type: 'button', class: 'link danger', onclick: () => {
        if (confirm(`Delete “${goal.title}” permanently? Its progress history will be lost too.\n\nTo just hide it, use “Archive”.`)) {
          dispatchGoals({ type: 'delete', id: goal.id });
          dialog.close();
        }
      } }, 'Delete…'),
    );
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    let category = String(f.category.value);
    if (category === NEW_CATEGORY) category = String(f.newCategory.value).trim();
    const horizon = /** @type {Horizon} */ (f.horizon.value);
    const targetRaw = String(f.target.value).trim().replace(',', '.');
    const target = targetRaw === '' ? null : Number(targetRaw);
    const deadline = horizon === 'deadline' ? String(f.deadline.value) || null : null;
    // Always the current period (kept when editing if the horizon does not change).
    const keepPeriod = goal && goal.horizon === horizon && goal.period;
    const period = horizon === 'deadline' ? null : keepPeriod || periodKey(horizon, new Date(), tz());
    if (!title) return f.title.focus();
    if (!category) return f.newCategory.focus();
    if (target !== null && (!Number.isFinite(target) || target <= 0)) return alert('The target must be a number greater than 0 (or leave it empty).');
    if (horizon === 'deadline' && !deadline) return alert('Set the deadline.');
    const fields = {
      title,
      category,
      horizon,
      target,
      unit: target !== null ? String(f.unit.value).trim() || null : null,
      deadline,
      period,
      repo: String(f.repo.value).trim() || null,
      location: String(f.location.value).trim() || null,
      notes: String(f.notes.value).trim() || null,
    };
    // Sub-goals: empty ones are dropped; when editing, individual operations so checkboxes ticked elsewhere are not overwritten.
    const rows = Array.from(subList.querySelectorAll('li'), (li) => ({
      id: li.dataset.id ?? '',
      title: /** @type {HTMLInputElement} */ (li.querySelector('input')).value.trim(),
    })).filter((r) => r.title);
    if (goal) {
      const old = goal.subgoals ?? [];
      /** @type {Op[]} */
      const subOps = [
        ...old.filter((s) => !rows.some((r) => r.id === s.id)).map((s) => /** @type {Op} */ ({ type: 'removeSub', id: goal.id, subId: s.id })),
        ...rows.flatMap((r) => {
          const prev = old.find((s) => s.id === r.id);
          if (!prev) return [/** @type {Op} */ ({ type: 'addSub', id: goal.id, sub: { id: newId('s_'), title: r.title, done: [] } })];
          return prev.title === r.title ? [] : [/** @type {Op} */ ({ type: 'editSub', id: goal.id, subId: r.id, title: r.title })];
        }),
      ];
      dispatchGoals({ type: 'edit', id: goal.id, fields }, ...subOps);
    } else {
      /** @type {Goal} */
      const g = { id: newId(), kind: 'goal', ...fields, progress: {}, createdAt: new Date().toISOString() };
      if (rows.length) g.subgoals = rows.map((r) => ({ id: newId('s_'), title: r.title, done: [] }));
      dispatchGoals({ type: 'add', goal: g });
    }
    dialog.close();
  };

  dialog.showModal();
  if (!goal) f.title.focus();
}

/** Editable row of a sub-goal in the form. @param {string} id @param {string} title */
export function subgoalRow(id, title) {
  return editRow(id, title, 'Step towards the goal', 'add-subgoal');
}

/** @param {HTMLFormElement} form */
export function syncFormVisibility(form) {
  const f = /** @type {any} */ (form.elements);
  $('field-new-category').hidden = f.category.value !== NEW_CATEGORY;
  $('field-deadline').hidden = f.horizon.value !== 'deadline';
  const hz = /** @type {Horizon} */ (f.horizon.value);
  $('horizon-hint').textContent = hz === 'deadline' ? '' : `Ends with ${HORIZON_LABEL[hz].toLowerCase()} (${periodKey(hz, new Date(), tz())}), then moves to Past.`;
  f.deadline.required = f.horizon.value === 'deadline';
}

export function openManage() {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('manage-dialog'));
  renderManage();
  const addForm = /** @type {HTMLFormElement} */ ($('category-form'));
  const input = /** @type {HTMLInputElement} */ (addForm.elements.namedItem('name'));
  input.value = '';
  addForm.onsubmit = (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    if (current().categories.includes(name)) return alert(`The category “${name}” already exists.`);
    dispatchGoals({ type: 'addCategory', name });
    input.value = '';
    renderManage();
  };
  const tzForm = /** @type {HTMLFormElement} */ ($('tz-form'));
  const tzInput = /** @type {HTMLInputElement} */ (tzForm.elements.namedItem('timeZone'));
  tzInput.value = current().timeZone ?? '';
  tzInput.placeholder = deviceTimeZone();
  tzForm.onsubmit = (ev) => {
    ev.preventDefault();
    const zone = tzInput.value.trim();
    if (!isValidTimeZone(zone)) return alert('Invalid time zone. Use the IANA format, e.g. America/Mexico_City.');
    if (zone === current().timeZone) return;
    if (!confirm(`Compute periods in ${zone}? Progress already saved stays in its period.`)) return;
    dispatchGoals({ type: 'setTimeZone', timeZone: zone });
    renderManage();
  };
  dialog.showModal();
}

export function renderManage() {
  const doc = current();
  const list = $('category-list');
  list.replaceChildren(
    ...doc.categories.map((name) => {
      const used = categoryUsage(doc, name);
      return h(
        'li',
        {},
        h('span', {}, name),
        h('span', { class: 'count' }, used ? `${used} ${used === 1 ? 'goal' : 'goals'}` : 'unused'),
        h(
          'button',
          {
            type: 'button',
            class: 'link danger',
            disabled: used > 0,
            title: used > 0 ? 'Move or delete its goals first (archived ones too)' : '',
            onclick: () => {
              if (!confirm(`Remove the category “${name}”?`)) return;
              dispatchGoals({ type: 'removeCategory', name });
              renderManage();
            },
          },
          'Remove',
        ),
      );
    }),
  );
  if (!doc.categories.length) list.append(h('li', { class: 'count' }, 'No categories yet.'));
  $('tz-current').textContent = doc.timeZone
    ? `Current: ${doc.timeZone}`
    : `The file has no time zone; using this device's (${deviceTimeZone()}).`;
}

// ---------------------------------------------------------------- area page and Home

/** Active goals of some areas. @param {Set<string>} ids */
function liveGoals(ids) {
  const now = new Date();
  return current().goals.filter((g) => !g.archived && !isExpired(g, now, tz()) && inAreas(ids, g.category));
}

/** @param {import('../index.js').AreaScope} scope */
export function areaSections({ ids }) {
  const goals = liveGoals(ids).sort((a, b) => HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon));
  return goals.length ? [h('ul', { class: 'rows' }, ...goals.map(goalRow))] : [h('p', { class: 'empty small' }, 'No active goals in this area.')];
}

/**
 * Number of active goals and the progress of up to two of them (the shortest horizon first).
 * @param {import('../index.js').AreaScope} scope
 * @returns {import('../index.js').HomeCard}
 */
export function homeCard({ ids }) {
  const goals = liveGoals(ids).sort((a, b) => HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon));
  if (!goals.length) return { stats: [], body: [] };
  const now = new Date();
  const bars = goals.slice(0, 2).map((g) => {
    const key = goalKey(g, now, tz());
    const value = g.progress[key] ?? 0;
    const target = g.target && g.target > 0 ? g.target : 1;
    const fill = h('span');
    fill.style.width = `${Math.min(100, (value / target) * 100)}%`;
    return h(
      'li',
      { class: 'mini goal-bar' },
      h('span', { class: 'mini-title' }, g.title),
      h('span', { class: 'count' }, `${fmt(value)}/${fmt(target)}`),
      h('div', { class: 'bar' }, fill),
    );
  });
  return { stats: [['goals', goals.length]], body: [h('ul', { class: 'mini-list' }, ...bars)] };
}
