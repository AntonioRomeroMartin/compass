// @ts-check
import { HORIZONS, periodKey, periodKeys, daysUntil, civilDate, deviceTimeZone, isValidTimeZone, endOfWeek, addDays } from '../lib/period.js';
import * as goalsLib from '../lib/goals.js';
import * as tasksLib from '../lib/tasks.js';
import * as domainsLib from '../lib/domains.js';
import { buildToday } from '../lib/today.js';
import { GitHubError, readFile, writeFile } from '../lib/github.js';
import { createStore } from './store.js';

const { categoryUsage, emptyDoc, goalKey, isDone, isExpired, newId, normalize, serialize, subgoalsDone } = goalsLib;

/** @typedef {import('../lib/goals.js').Goal} Goal */
/** @typedef {import('../lib/goals.js').GoalsDoc} GoalsDoc */
/** @typedef {import('../lib/goals.js').Op} Op */
/** @typedef {import('../lib/goals.js').Subgoal} Subgoal */
/** @typedef {import('../lib/tasks.js').Task} Task */
/** @typedef {import('../lib/period.js').Horizon} Horizon */
/** @typedef {import('../lib/github.js').RepoConfig} RepoConfig */
/** @typedef {'today'|'areas'|'goals'|'more'} Tab */

// localStorage keys keep the "goals." prefix of the first version, so existing devices keep their settings.
const LS = { cfg: 'goals.cfg', ui: 'goals.ui', theme: 'compass.theme' };
/** @type {Tab[]} */
const TABS = ['today', 'areas', 'goals', 'more'];
/** @type {Record<Tab, string>} */
const TAB_TITLE = { today: 'Today', areas: 'Areas', goals: 'Goals', more: 'More' };

/** @type {Record<Horizon, string>} */
const HORIZON_LABEL = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  deadline: 'With deadline',
};
/** @type {Record<Horizon, string>} */
const HORIZON_SHORT = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
  deadline: 'Deadline',
};

// ---------------------------------------------------------------- state

const state = {
  /** @type {RepoConfig|null} */
  cfg: null,
  /** @type {Tab} */
  tab: 'today',
  /** @type {'horizon'|'category'} */
  view: 'horizon',
  filter: '',
  /** @type {'active'|'past'|'archived'} */
  scope: 'active',
  /** the "No date" block of Today is unfolded */
  undatedOpen: false,
  /** area whose page is open in Areas ('' = the list) and the sub-area chosen in it */
  area: '',
  subArea: '',
};

// ---------------------------------------------------------------- local storage

/** @param {string} key */
function lsGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
/** @param {string} key @param {unknown} value */
function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the app keeps working in memory
  }
}

function persist() {
  lsSet(LS.ui, { tab: state.tab, view: state.view, filter: state.filter, scope: state.scope, undatedOpen: state.undatedOpen, area: state.area, subArea: state.subArea });
}

// ---------------------------------------------------------------- data files

const cfg = () => state.cfg;
const goalsStore = createStore({ mod: goalsLib, file: '', ls: 'goals', empty: () => emptyDoc(), cfg, onChange: () => render() });
const tasksStore = createStore({ mod: tasksLib, file: 'tasks.json', ls: 'compass.tasks', empty: () => tasksLib.emptyDoc(goalsStore.current().timeZone), cfg, onChange: () => render() });
const domainsStore = createStore({ mod: domainsLib, file: 'domains.json', ls: 'compass.domains', empty: () => domainsLib.emptyDoc(), cfg, onChange: () => render() });
const STORES = [goalsStore, tasksStore, domainsStore];

const current = () => goalsStore.current();
/** Time zone of the periods: the goals file's; if it has none, the device's. */
const tz = () => {
  const zone = current().timeZone;
  return isValidTimeZone(zone) ? zone : deviceTimeZone();
};
const online = () => navigator.onLine && STORES.every((st) => st.state.online);
const loaded = () => STORES.every((st) => st.state.loaded);
const canEdit = () => online() && goalsStore.state.loaded && !!state.cfg;

async function refresh() {
  if (!state.cfg) return;
  await Promise.all(STORES.map((st) => st.refresh()));
}

/** @param {...Op} ops */
function dispatch(...ops) {
  if (!canEdit() || !ops.length) return;
  goalsStore.dispatch(ops);
}

// ---------------------------------------------------------------- DOM helpers

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el) /** @type {any} */ (el)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {number} n */
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-GB', { maximumFractionDigits: 2 }));

// ---------------------------------------------------------------- render

function render() {
  renderTabs();
  renderDate();
  renderStatus();
  if (state.tab === 'today') renderTodayView();
  if (state.tab === 'areas') renderAreas();
  if (state.tab === 'goals') {
    renderToolbar();
    renderList();
  }
  /** @type {HTMLButtonElement} */ ($('add')).disabled = !canEdit();
  /** @type {HTMLButtonElement} */ ($('manage')).disabled = !canEdit();
  /** @type {HTMLButtonElement} */ ($('open-manage')).disabled = !canEdit();
}

function renderTabs() {
  for (const btn of document.querySelectorAll('[data-tab]')) {
    const tab = /** @type {HTMLElement} */ (btn).dataset.tab;
    if (tab === state.tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  for (const sec of document.querySelectorAll('[data-view-of]')) {
    /** @type {HTMLElement} */ (sec).hidden = /** @type {HTMLElement} */ (sec).dataset.viewOf !== state.tab;
  }
  $('page-title').textContent = TAB_TITLE[state.tab];
}

/** @param {Tab} tab */
function go(tab) {
  if (tab === 'areas' && state.tab === 'areas') state.area = '';
  state.tab = tab;
  persist();
  render();
  window.scrollTo(0, 0);
}

function renderDate() {
  const t = civilDate(new Date(), tz());
  $('today').textContent = new Date(Date.UTC(t.y, t.m - 1, t.d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function renderStatus() {
  const saving = STORES.some((st) => st.state.saving);
  const pending = STORES.some((st) => st.state.pending.length);
  const error = STORES.map((st) => st.state.error).find(Boolean);
  const status = $('status');
  let text = '';
  if (!state.cfg) text = 'Not set up';
  else if (!online()) text = 'Offline';
  else if (saving) text = 'Saving…';
  else if (pending) text = 'Pending changes…';
  else if (loaded()) text = 'Synced';
  else text = 'Loading…';
  status.textContent = text;
  status.dataset.state = !online() ? 'offline' : pending || saving ? 'busy' : 'ok';

  const banner = $('banner');
  banner.replaceChildren();
  banner.hidden = true;
  banner.dataset.kind = 'info';
  if (!state.cfg) {
    banner.append('Connect to GitHub to get started. ', h('button', { class: 'link', onclick: openSettings }, 'Set up'));
    banner.hidden = false;
  } else if (!online()) {
    const at = goalsStore.state.fetchedAt;
    const when = at ? new Date(at).toLocaleString('en-GB', { timeZone: tz() }) : 'never';
    banner.append(`Offline: showing saved data (${when}). Editing is disabled.`);
    banner.dataset.kind = 'warn';
    banner.hidden = false;
  } else if (error) {
    banner.append(error, ' ', h('button', { class: 'link', onclick: retry }, 'Retry'));
    banner.dataset.kind = 'error';
    banner.hidden = false;
  }
}

function retry() {
  for (const st of STORES) st.state.error = null;
  refresh();
}

// ---------------------------------------------------------------- today

/** Civil date of today in the data's time zone. */
const todayKey = () => periodKey('day', new Date(), tz());

/** @param {Task} t */
function toggleTask(t) {
  if (!canEdit()) return;
  const now = new Date();
  if (t.status === 'open') {
    tasksStore.dispatch([{ type: 'done', id: t.id, at: now.toISOString(), today: todayKey(), nextId: t.repeat ? newId('t_') : null }]);
  } else {
    tasksStore.dispatch([{ type: 'reopen', id: t.id }]);
  }
  // A task linked to a goal adds (or takes back) 1.
  const g = t.goal ? current().goals.find((x) => x.id === t.goal) : null;
  if (g) dispatch({ type: 'inc', id: g.id, key: goalKey(g, now, tz()), delta: t.status === 'open' ? 1 : -1 });
}

/** @param {Task} t @param {boolean} [showArea] */
function taskRow(t, showArea = false) {
  const doms = domainsStore.current();
  const d = t.due ? daysUntil(t.due, new Date(), tz()) : null;
  const when = d === null ? null : d < 0 ? `${-d}d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : t.due;
  const done = t.status !== 'open';
  return h(
    'li',
    { class: done ? 'task done' : 'task' },
    h('input', { type: 'checkbox', checked: done, disabled: !canEdit(), 'aria-label': `Done: ${t.title}`, onchange: () => toggleTask(t) }),
    h('button', { class: 'task-title', disabled: !canEdit(), onclick: () => openTaskForm(t) }, t.title),
    h(
      'span',
      { class: 'task-meta' },
      t.subtasks.length ? h('span', { class: 'chip muted' }, `${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}`) : null,
      showArea ? h('span', { class: 'chip muted' }, domainsLib.label(doms, domainsLib.canonical(doms, t.domain)) || t.domain) : null,
      when ? h('span', { class: d !== null && d < 0 ? 'chip danger' : d === 0 ? 'chip warn' : 'chip' }, when) : null,
      t.repeat ? h('span', { class: 'chip muted', title: tasksLib.repeatText(t.repeat) }, '↻') : null,
    ),
  );
}

/** Compact goal row for Today: title, progress and +1. @param {Goal} g */
function goalRow(g) {
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
        onclick: () => dispatch(target ? { type: 'inc', id: g.id, key, delta: 1 } : { type: 'set', id: g.id, key, value: done ? 0 : 1 }),
      }, target ? '+' : done ? '✓' : '○'),
    ),
  );
}

function renderTodayView() {
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
  if (!t.groups.length) view.append(h('p', { class: 'empty' }, 'Nothing due today or this week. Add a task with “+”.'));
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

// ---------------------------------------------------------------- task form

/** Choices of the "When" chips; "pick" shows the date field. */
const WHEN = /** @type {const} */ ([['none', 'No date'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['nextweek', 'Next week'], ['pick', 'Pick date…']]);

/** @param {string} today */
function nextMonday(today) {
  for (let i = 1; i <= 7; i++) {
    const d = tasksLib.parseDue(`+${i}`, today);
    if (d && new Date(`${d}T12:00:00Z`).getUTCDay() === 1) return d;
  }
  return today;
}

/** Chips that work as a single choice. @param {HTMLElement} box @param {[string, string][]} items @param {string} value @param {(v: string) => void} onPick */
function chipPicker(box, items, value, onPick) {
  box.replaceChildren(
    ...items.map(([v, text]) => h('button', {
      type: 'button', role: 'radio', class: 'chip-opt', 'aria-checked': String(v === value), 'data-v': v,
      onclick: (/** @type {MouseEvent} */ ev) => {
        for (const b of box.querySelectorAll('button')) b.setAttribute('aria-checked', String(b === ev.currentTarget));
        onPick(v);
      },
    }, text)),
  );
}

/** @param {Task} [task] @param {string} [domain] area chosen in advance (e.g. from an area's page) */
function openTaskForm(task, domain) {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('task-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('task-form'));
  const f = /** @type {any} */ (form.elements);
  const doms = domainsStore.current();
  const today = todayKey();
  const msg = $('task-msg');
  msg.textContent = '';

  $('task-dialog-title').textContent = task ? 'Edit task' : 'New task';
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!task;
  $('task-submit').textContent = task ? 'Save' : 'Add';
  f.title.value = task?.title ?? '';

  // Area: parents followed by their sub-areas.
  let area = task ? domainsLib.canonical(doms, task.domain) || task.domain : domain ?? '';
  /** @type {[string, string][]} */
  const areaItems = [];
  /** @param {string|undefined} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const d of doms.domains.filter((x) => (x.parent ?? '') === (parent ?? ''))) {
      areaItems.push([d.id, d.name]);
      walk(d.id, depth + 1);
    }
  };
  walk(undefined, 0);
  if (area && !areaItems.some(([id]) => id === area)) areaItems.push([area, area]);
  chipPicker($('task-areas'), areaItems, area, (v) => { area = v; });
  for (const b of $('task-areas').querySelectorAll('button')) {
    const d = domainsLib.find(doms, /** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.v));
    if (d?.parent) b.classList.add('sub');
  }

  // When.
  const due = task?.due ?? null;
  const preset = !due ? 'none' : due === today ? 'today' : due === tasksLib.parseDue('tomorrow', today) ? 'tomorrow' : 'pick';
  let when = /** @type {string} */ (preset);
  f.due.value = due ?? '';
  f.due.hidden = when !== 'pick';
  chipPicker($('task-when'), WHEN.map(([v, t]) => [v, t]), when, (v) => {
    when = v;
    f.due.hidden = v !== 'pick';
    if (v === 'pick') { if (!f.due.value) f.due.value = today; f.due.focus(); }
    syncRepeatHint();
  });

  // More options.
  const r = task?.repeat ?? null;
  const rText = r ? tasksLib.repeatText(r) : '';
  f.repeat.value = !r ? '' : rText === 'daily' ? 'daily' : rText === 'weekly mon,tue,wed,thu,fri' ? 'weekdays' : 'custom';
  f.repeatCustom.value = f.repeat.value === 'custom' ? rText : '';
  f.notes.value = task?.notes ?? '';
  const now = new Date();
  const goals = current().goals.filter((g) => !g.archived && !isExpired(g, now, tz()));
  f.goal.replaceChildren(h('option', { value: '' }, 'None'), ...goals.map((g) => h('option', { value: g.id }, g.title)));
  f.goal.value = task?.goal && goals.some((g) => g.id === task.goal) ? task.goal : '';
  f.location.value = task?.location ?? '';
  const subList = $('subtask-list');
  subList.replaceChildren(...(task?.subtasks ?? []).map((st) => editRow(st.id, st.title, 'Step', 'add-subtask')));
  $('add-subtask').onclick = () => {
    const row = editRow('', '', 'Step', 'add-subtask');
    subList.append(row);
    /** @type {HTMLInputElement} */ (row.querySelector('input')).focus();
  };
  /** @type {HTMLDetailsElement} */ ($('task-more')).open = false;

  const dueValue = () => (when === 'none' ? null : when === 'today' ? today : when === 'tomorrow' ? tasksLib.parseDue('tomorrow', today)
    : when === 'nextweek' ? nextMonday(today) : String(f.due.value) || null);
  /** The rule chosen, or an Error. */
  const repeatValue = () => {
    const kind = String(f.repeat.value);
    const text = kind === 'custom' ? String(f.repeatCustom.value) : kind;
    try {
      return tasksLib.parseRepeat(text, dueValue() ?? today);
    } catch (e) {
      return /** @type {Error} */ (e);
    }
  };
  function syncRepeatHint() {
    $('field-repeat-custom').hidden = f.repeat.value !== 'custom';
    const rule = repeatValue();
    $('task-repeat-hint').textContent = rule instanceof Error ? rule.message
      : rule ? `Repeats ${tasksLib.repeatText(rule)}: when you complete it, the next one is created.` : '';
  }
  f.repeat.onchange = syncRepeatHint;
  f.repeatCustom.oninput = syncRepeatHint;
  f.due.onchange = syncRepeatHint;
  syncRepeatHint();

  const extra = $('task-extra-actions');
  extra.replaceChildren();
  if (task) {
    if (task.status === 'open') {
      extra.append(h('button', { type: 'button', class: 'btn', onclick: () => {
        const stop = !!task.repeat && confirm('Stop repeating it too?\n\nOK: no more copies. Cancel: drop only this one.');
        tasksStore.dispatch([{ type: 'drop', id: task.id, at: new Date().toISOString(), today, nextId: task.repeat && !stop ? newId('t_') : null }]);
        dialog.close();
      } }, 'Drop'));
    } else {
      extra.append(h('button', { type: 'button', class: 'btn', onclick: () => { tasksStore.dispatch([{ type: 'reopen', id: task.id }]); dialog.close(); } }, 'Reopen'));
    }
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      if (!confirm(`Delete “${task.title}” permanently?\n\nTo keep a record, use “Drop”.`)) return;
      tasksStore.dispatch([{ type: 'delete', id: task.id }]);
      dialog.close();
    } }, 'Delete…'));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    if (!title) return f.title.focus();
    if (!area) { msg.textContent = 'Choose an area.'; return; }
    if (when === 'pick' && !f.due.value) { msg.textContent = 'Pick a date.'; return; }
    const rule = repeatValue();
    if (rule instanceof Error) { /** @type {HTMLDetailsElement} */ ($('task-more')).open = true; msg.textContent = rule.message; return; }
    const fields = {
      title,
      domain: area,
      due: dueValue(),
      repeat: rule,
      notes: String(f.notes.value).trim() || null,
      goal: String(f.goal.value) || null,
      location: String(f.location.value).trim() || null,
    };
    const rows = Array.from(subList.querySelectorAll('li'), (li) => ({
      id: li.dataset.id ?? '',
      title: /** @type {HTMLInputElement} */ (li.querySelector('input')).value.trim(),
    })).filter((x) => x.title);
    if (task) {
      const old = task.subtasks;
      /** @type {import('../lib/tasks.js').Op[]} */
      const ops = [
        { type: 'edit', id: task.id, fields },
        ...old.filter((x) => !rows.some((r) => r.id === x.id)).map((x) => /** @type {const} */ ({ type: 'removeSub', id: task.id, subId: x.id })),
        ...rows.flatMap((r) => {
          const prev = old.find((x) => x.id === r.id);
          if (!prev) return [/** @type {const} */ ({ type: 'addSub', id: task.id, sub: { id: newId('s_'), title: r.title, done: false } })];
          return prev.title === r.title ? [] : [/** @type {const} */ ({ type: 'editSub', id: task.id, subId: r.id, title: r.title })];
        }),
      ];
      tasksStore.dispatch(ops);
    } else {
      const t = tasksLib.newTask({ ...fields, subtasks: rows.map((r) => ({ id: newId('s_'), title: r.title, done: false })) });
      tasksStore.dispatch([{ type: 'add', task: t }]);
    }
    dialog.close();
  };

  dialog.showModal();
  if (!task) f.title.focus();
}

// ---------------------------------------------------------------- areas

function renderAreas() {
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

/** An area and all its sub-areas. @param {string} id */
function areaIds(id) {
  return new Set([id, ...domainsLib.descendants(domainsStore.current(), id)]);
}

/** @param {string} id */
function openArea(id) {
  state.area = id;
  state.subArea = '';
  persist();
  render();
  window.scrollTo(0, 0);
}

/** Page of one area: its open tasks by date, its goals and what was done in the last 7 days. @param {HTMLElement} view @param {string} id */
function renderArea(view, id) {
  const doms = domainsStore.current();
  const area = /** @type {import('../lib/domains.js').Domain} */ (domainsLib.find(doms, id));
  $('page-title').textContent = area.name;
  const kids = domainsLib.children(doms, id);
  const scopeId = state.subArea && kids.some((k) => k.id === state.subArea) ? state.subArea : id;
  const ids = areaIds(scopeId);
  const inArea = (/** @type {string} */ text) => ids.has(domainsLib.canonical(doms, text));
  const today = todayKey();
  const weekEnd = endOfWeek(today);
  const all = tasksStore.current().tasks.filter((t) => inArea(t.domain));
  const open = all.filter((t) => t.status === 'open').sort(tasksLib.byDue);
  const now = new Date();
  const goals = current().goals.filter((g) => !g.archived && !isExpired(g, now, tz()) && inArea(g.category));
  const since = addDays(today, -7);
  const recent = all
    .filter((t) => t.status !== 'open' && t.doneAt && periodKey('day', new Date(t.doneAt), tz()) >= since)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));

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

  /** @type {[string, Task[]][]} */
  const buckets = [
    ['Overdue', open.filter((t) => t.due && t.due < today)],
    ['Today', open.filter((t) => t.due === today)],
    ['This week', open.filter((t) => t.due && t.due > today && t.due <= weekEnd)],
    ['Later', open.filter((t) => t.due && t.due > weekEnd)],
    ['No date', open.filter((t) => !t.due)],
  ];
  const showSub = scopeId === id && kids.length > 0;
  for (const [title, list] of buckets) {
    if (!list.length) continue;
    view.append(h('section', { class: 'group' }, h('h2', {}, title, h('span', { class: 'sub' }, String(list.length))), h('ul', { class: 'rows' }, ...list.map((t) => taskRow(t, showSub && domainsLib.canonical(doms, t.domain) !== id)))));
  }
  if (!open.length) view.append(h('p', { class: 'empty small' }, 'No open tasks here.'));
  if (goals.length) view.append(h('section', { class: 'group' }, h('h2', {}, 'Goals'), h('ul', { class: 'rows' }, ...goals.map(goalRow))));
  if (recent.length) {
    view.append(h(
      'details',
      { class: 'group undated' },
      h('summary', {}, h('h2', {}, 'Done in the last 7 days', h('span', { class: 'sub' }, String(recent.length)))),
      h('ul', { class: 'rows' }, ...recent.map((t) => taskRow(t))),
    ));
  }
}

// ---------------------------------------------------------------- goal form

const NEW_CATEGORY = '__new__';

/** @param {Goal} [goal] */
function openGoalForm(goal) {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('goal-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('goal-form'));
  const doc = current();
  const f = /** @type {any} */ (form.elements);

  $('goal-dialog-title').textContent = goal ? 'Edit goal' : 'New goal';
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!goal;
  f.title.value = goal?.title ?? '';
  f.category.replaceChildren(
    ...doc.categories.map((c) => h('option', { value: c }, c)),
    h('option', { value: NEW_CATEGORY }, '+ New category…'),
  );
  f.category.value = goal?.category ?? (state.filter || doc.categories[0] || NEW_CATEGORY);
  f.newCategory.value = '';
  f.horizon.value = goal?.horizon ?? 'week';
  f.target.value = goal?.target ?? '';
  f.unit.value = goal?.unit ?? '';
  f.deadline.value = goal?.deadline ?? '';
  f.repeat.checked = !!goal?.repeat;
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
      h('button', { type: 'button', class: 'btn', onclick: () => { dispatch({ type: 'archive', id: goal.id, archived: !goal.archived }); dialog.close(); } }, goal.archived ? 'Restore' : 'Archive'),
      h('button', { type: 'button', class: 'link danger', onclick: () => {
        if (confirm(`Delete “${goal.title}” permanently? Its progress history will be lost too.\n\nTo just hide it, use “Archive”.`)) {
          dispatch({ type: 'delete', id: goal.id });
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
    const repeat = horizon !== 'deadline' && !!f.repeat.checked;
    // One-off: always the current period (kept when editing if the horizon does not change).
    const keepPeriod = goal && !goal.repeat && goal.horizon === horizon && goal.period;
    const period = repeat || horizon === 'deadline' ? null : keepPeriod || periodKey(horizon, new Date(), tz());
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
      repeat,
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
      dispatch({ type: 'edit', id: goal.id, fields }, ...subOps);
    } else {
      /** @type {Goal} */
      const g = { id: newId(), kind: 'goal', ...fields, progress: {}, createdAt: new Date().toISOString() };
      if (rows.length) g.subgoals = rows.map((r) => ({ id: newId('s_'), title: r.title, done: [] }));
      dispatch({ type: 'add', goal: g });
    }
    dialog.close();
  };

  dialog.showModal();
  if (!goal) f.title.focus();
}

/** Editable row of a sub-goal in the form. @param {string} id @param {string} title */
function subgoalRow(id, title) {
  return editRow(id, title, 'Step towards the goal', 'add-subgoal');
}

/**
 * Editable row of a list of steps (sub-goals, subtasks); Enter adds another row instead of submitting.
 * @param {string} id @param {string} title @param {string} placeholder @param {string} addId id of the "+ Add" button
 */
function editRow(id, title, placeholder, addId) {
  const li = h('li', {});
  if (id) li.dataset.id = id;
  const input = h('input', { value: title, maxlength: 120, autocomplete: 'off', placeholder, 'aria-label': placeholder });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    /** @type {HTMLButtonElement} */ ($(addId)).click();
  });
  li.append(input, h('button', { type: 'button', class: 'link danger', 'aria-label': 'Remove', onclick: () => li.remove() }, 'Remove'));
  return li;
}

/** @param {HTMLFormElement} form */
function syncFormVisibility(form) {
  const f = /** @type {any} */ (form.elements);
  $('field-new-category').hidden = f.category.value !== NEW_CATEGORY;
  $('field-deadline').hidden = f.horizon.value !== 'deadline';
  $('field-repeat').hidden = f.horizon.value === 'deadline';
  const hz = /** @type {Horizon} */ (f.horizon.value);
  $('repeat-hint').textContent = hz === 'deadline' ? '' : f.repeat.checked
    ? `Habit: renews every ${hz}.`
    : `One-off: ends with ${HORIZON_LABEL[hz].toLowerCase()} (${periodKey(hz, new Date(), tz())}), then moves to Past.`;
  f.deadline.required = f.horizon.value === 'deadline';
}

// ---------------------------------------------------------------- settings

function openSettings() {
  const dialog = /** @type {HTMLDialogElement} */ ($('settings-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('settings-form'));
  const f = /** @type {any} */ (form.elements);
  const cfg = state.cfg;
  f.token.value = cfg?.token ?? '';
  f.owner.value = cfg?.owner ?? '';
  f.repo.value = cfg?.repo ?? '';
  f.path.value = cfg?.path ?? 'goals.json';
  f.branch.value = cfg?.branch ?? 'main';
  const msg = $('settings-msg');
  msg.textContent = '';

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    /** @type {RepoConfig} */
    const next = {
      token: String(f.token.value).trim(),
      owner: String(f.owner.value).trim(),
      repo: String(f.repo.value).trim(),
      path: String(f.path.value).trim(),
      branch: String(f.branch.value).trim() || 'main',
    };
    msg.textContent = 'Checking…';
    try {
      const { text } = await readFile(next);
      normalize(JSON.parse(text));
    } catch (err) {
      const missing = err instanceof GitHubError && err.status === 404;
      if (!missing) {
        msg.textContent = err instanceof SyntaxError ? 'The file is not valid JSON.' : /** @type {Error} */ (err).message;
        return;
      }
      const zone = deviceTimeZone();
      const ok = confirm(
        `${next.path} was not found in ${next.owner}/${next.repo} (branch ${next.branch}).\n\n` +
        `If the repo exists and the token has access, create an empty file? ` +
        `Periods will be computed in the ${zone} time zone (you can change it).`,
      );
      if (!ok) { msg.textContent = 'File not found.'; return; }
      try {
        await writeFile(next, serialize(emptyDoc(zone)), null, 'goals: create file');
      } catch (e) {
        msg.textContent = `Could not create it: ${/** @type {Error} */ (e).message}`;
        return;
      }
    }
    const changedTarget = !state.cfg || ['owner', 'repo', 'path', 'branch'].some((k) => /** @type {any} */ (state.cfg)[k] !== /** @type {any} */ (next)[k]);
    state.cfg = next;
    lsSet(LS.cfg, next);
    if (changedTarget) for (const st of STORES) st.reset();
    dialog.close();
    refresh();
  };

  $('forget-token').onclick = () => {
    if (!confirm('Forget the token on this device? Unsaved changes will be lost.')) return;
    state.cfg = null;
    for (const st of STORES) st.reset();
    lsSet(LS.cfg, null);
    dialog.close();
    render();
  };

  dialog.showModal();
}

// ---------------------------------------------------------------- categories and time zone

function openManage() {
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
    dispatch({ type: 'addCategory', name });
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
    dispatch({ type: 'setTimeZone', timeZone: zone });
    renderManage();
  };
  dialog.showModal();
}

function renderManage() {
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
              dispatch({ type: 'removeCategory', name });
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

// ---------------------------------------------------------------- theme

/** Light or dark as shown now: the one chosen on this device, or the system's. */
const shownTheme = () => document.documentElement.dataset.theme
  ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** @param {string|null} theme 'light' | 'dark' | null (follow the system) */
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = shownTheme() === 'dark';
  const btn = $('theme');
  btn.textContent = dark ? '☀' : '☾';
  btn.title = dark ? 'Switch to light' : 'Switch to dark';
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', dark ? '#17171a' : '#f6f5f1');
}

// ---------------------------------------------------------------- startup

function init() {
  applyTheme(lsGet(LS.theme));
  $('theme').addEventListener('click', () => {
    const next = shownTheme() === 'dark' ? 'light' : 'dark';
    lsSet(LS.theme, next);
    applyTheme(next);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(lsGet(LS.theme)));
  state.cfg = lsGet(LS.cfg);
  const ui = lsGet(LS.ui);
  if (ui) {
    state.view = ui.view === 'category' ? 'category' : 'horizon';
    state.filter = typeof ui.filter === 'string' ? ui.filter : '';
    state.scope = ['active', 'past', 'archived'].includes(ui.scope) ? ui.scope : ui.showArchived ? 'archived' : 'active';
    if (TABS.includes(ui.tab)) state.tab = ui.tab;
    state.undatedOpen = ui.undatedOpen === true;
    state.area = typeof ui.area === 'string' ? ui.area : '';
    state.subArea = typeof ui.subArea === 'string' ? ui.subArea : '';
  }

  for (const btn of document.querySelectorAll('[data-tab]')) {
    btn.addEventListener('click', () => go(/** @type {Tab} */ (/** @type {HTMLElement} */ (btn).dataset.tab)));
  }

  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      state.view = /** @type {any} */ (/** @type {HTMLElement} */ (btn).dataset.view);
      persist();
      render();
    });
  }
  $('filter').addEventListener('change', (ev) => {
    state.filter = /** @type {HTMLSelectElement} */ (ev.target).value;
    persist();
    render();
  });
  $('scope').addEventListener('change', (ev) => {
    state.scope = /** @type {any} */ (/** @type {HTMLSelectElement} */ (ev.target).value);
    persist();
    render();
  });
  $('add').addEventListener('click', () => openTaskForm());
  // Task · Goal switch at the top of a new item's sheet.
  for (const btn of document.querySelectorAll('[data-switch]')) {
    btn.addEventListener('click', () => {
      /** @type {HTMLDialogElement} */ (btn.closest('dialog')).close();
      if (/** @type {HTMLElement} */ (btn).dataset.switch === 'goal') openGoalForm();
      else openTaskForm();
    });
  }
  $('refresh').addEventListener('click', refresh);
  $('settings').addEventListener('click', openSettings);
  $('manage').addEventListener('click', openManage);
  $('open-manage').addEventListener('click', openManage);
  $('task-dialog').addEventListener('close', () => render());
  const goalForm = /** @type {HTMLFormElement} */ ($('goal-form'));
  goalForm.addEventListener('change', () => syncFormVisibility(goalForm));
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => /** @type {HTMLDialogElement} */ (btn.closest('dialog')).close());
  }

  window.addEventListener('online', () => { for (const st of STORES) st.state.online = true; refresh(); });
  window.addEventListener('offline', () => render());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      for (const st of STORES) if (st.state.pending.length) st.flush();
    } else {
      refresh();
    }
  });
  // Day/week change (in the file's time zone) even if the app stays open.
  let lastKeys = JSON.stringify(periodKeys(new Date(), tz()));
  setInterval(() => {
    const keys = JSON.stringify(periodKeys(new Date(), tz()));
    if (keys !== lastKeys) { lastKeys = keys; render(); }
  }, 60000);

  render();
  if (state.cfg) refresh();
  else openSettings();

  // Not on a local preview: there every reload must show the files as they are now.
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
