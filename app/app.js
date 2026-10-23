// @ts-check
import { HORIZONS, periodKey, periodKeys, daysUntil, civilDate, deviceTimeZone, isValidTimeZone } from '../lib/period.js';
import { applyOps, categoryUsage, commitMessage, emptyDoc, goalKey, isDone, isExpired, newId, normalize, serialize, subgoalsDone } from '../lib/goals.js';
import { GitHubError, readFile, writeFile } from '../lib/github.js';

/** @typedef {import('../lib/goals.js').Goal} Goal */
/** @typedef {import('../lib/goals.js').GoalsDoc} GoalsDoc */
/** @typedef {import('../lib/goals.js').Op} Op */
/** @typedef {import('../lib/goals.js').Subgoal} Subgoal */
/** @typedef {import('../lib/period.js').Horizon} Horizon */
/** @typedef {import('../lib/github.js').RepoConfig} RepoConfig */

const SAVE_DELAY_MS = 2000;
const LS = { cfg: 'goals.cfg', cache: 'goals.cache', pending: 'goals.pending', ui: 'goals.ui' };

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
  /** Last document confirmed on GitHub. @type {GoalsDoc} */
  base: emptyDoc(),
  /** @type {string|null} */
  sha: null,
  /** Operations not saved yet. @type {Op[]} */
  pending: [],
  /** @type {string|null} ISO time of the last successful read */
  fetchedAt: null,
  online: navigator.onLine,
  loaded: false,
  saving: false,
  /** @type {string|null} */
  error: null,
  /** @type {'horizon'|'category'} */
  view: 'horizon',
  filter: '',
  /** @type {'active'|'past'|'archived'} */
  scope: 'active',
};

/** @type {ReturnType<typeof setTimeout>|undefined} */
let saveTimer;

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
  lsSet(LS.pending, state.pending.length ? state.pending : null);
  lsSet(LS.ui, { view: state.view, filter: state.filter, scope: state.scope });
}

function cacheBase() {
  lsSet(LS.cache, { doc: state.base, sha: state.sha, fetchedAt: state.fetchedAt });
}

// ---------------------------------------------------------------- sync

const current = () => applyOps(state.base, state.pending);
/** Time zone of the periods: the file's; if it has none, the device's. */
const tz = () => {
  const zone = current().timeZone;
  return isValidTimeZone(zone) ? zone : deviceTimeZone();
};
const canEdit = () => state.online && state.loaded && !!state.cfg;

/** fetch() fails with TypeError when there is no network. @param {unknown} err */
function isNetworkError(err) {
  return err instanceof TypeError;
}

async function refresh() {
  if (!state.cfg) return;
  try {
    const { text, sha } = await readFile(state.cfg);
    state.base = normalize(JSON.parse(text));
    state.sha = sha;
    state.fetchedAt = new Date().toISOString();
    state.loaded = true;
    state.online = true;
    state.error = null;
    cacheBase();
    if (state.pending.length) scheduleSave(0);
  } catch (err) {
    if (isNetworkError(err)) state.online = false;
    else state.error = err instanceof SyntaxError ? 'The data file is not valid JSON.' : /** @type {Error} */ (err).message;
  }
  render();
}

/** @param {number} [delay] */
function scheduleSave(delay = SAVE_DELAY_MS) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, delay);
}

async function flush() {
  if (state.saving || !state.pending.length || !state.cfg || !state.sha) return;
  state.saving = true;
  render();
  const batch = state.pending.slice();
  try {
    for (let attempt = 0; ; attempt++) {
      const next = applyOps(state.base, batch);
      try {
        const msg = commitMessage(batch, state.base, next);
        state.sha = await writeFile(state.cfg, serialize(next), /** @type {string} */ (state.sha), msg);
        state.base = next;
        state.pending = state.pending.slice(batch.length);
        state.fetchedAt = new Date().toISOString();
        state.error = null;
        cacheBase();
        persist();
        break;
      } catch (err) {
        const conflict = err instanceof GitHubError && (err.status === 409 || err.status === 422);
        if (!conflict || attempt >= 3) throw err;
        // Someone (e.g. a script) changed the file: re-read and re-apply on top.
        const { text, sha } = await readFile(state.cfg);
        state.base = normalize(JSON.parse(text));
        state.sha = sha;
      }
    }
  } catch (err) {
    if (isNetworkError(err)) state.online = false;
    else state.error = `Could not save: ${/** @type {Error} */ (err).message}`;
  } finally {
    state.saving = false;
    render();
  }
  if (state.pending.length && state.online && !state.error) scheduleSave();
}

/** @param {...Op} ops */
function dispatch(...ops) {
  if (!canEdit() || !ops.length) return;
  state.pending.push(...ops);
  persist();
  render();
  scheduleSave();
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
  renderToday();
  renderStatus();
  renderToolbar();
  renderList();
  /** @type {HTMLButtonElement} */ ($('add')).disabled = !canEdit();
  /** @type {HTMLButtonElement} */ ($('manage')).disabled = !canEdit();
}

function renderToday() {
  const t = civilDate(new Date(), tz());
  $('today').textContent = new Date(Date.UTC(t.y, t.m - 1, t.d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function renderStatus() {
  const status = $('status');
  let text = '';
  if (!state.cfg) text = 'Not set up';
  else if (!state.online) text = 'Offline';
  else if (state.saving) text = 'Saving…';
  else if (state.pending.length) text = 'Pending changes…';
  else if (state.loaded) text = 'Synced';
  else text = 'Loading…';
  status.textContent = text;
  status.dataset.state = !state.online ? 'offline' : state.pending.length || state.saving ? 'busy' : 'ok';

  const banner = $('banner');
  banner.replaceChildren();
  banner.hidden = true;
  banner.dataset.kind = 'info';
  if (!state.cfg) {
    banner.append('Connect to GitHub to get started. ', h('button', { class: 'link', onclick: openSettings }, 'Set up'));
    banner.hidden = false;
  } else if (!state.online) {
    const when = state.fetchedAt ? new Date(state.fetchedAt).toLocaleString('en-GB', { timeZone: tz() }) : 'never';
    banner.append(`Offline: showing saved data (${when}). Editing is disabled.`);
    banner.dataset.kind = 'warn';
    banner.hidden = false;
  } else if (state.error) {
    banner.append(state.error, ' ', h('button', { class: 'link', onclick: retry }, 'Retry'));
    banner.dataset.kind = 'error';
    banner.hidden = false;
  }
}

function retry() {
  state.error = null;
  refresh();
}

function renderToolbar() {
  const doc = current();
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (btn).dataset.view === state.view));
  }
  const select = /** @type {HTMLSelectElement} */ ($('filter'));
  select.replaceChildren(
    h('option', { value: '' }, 'All categories'),
    ...doc.categories.map((c) => h('option', { value: c }, c)),
  );
  if (state.filter && !doc.categories.includes(state.filter)) state.filter = '';
  select.value = state.filter;
  /** @type {HTMLSelectElement} */ ($('scope')).value = state.scope;
}

function renderList() {
  const main = $('list');
  main.replaceChildren();
  const doc = current();
  const now = new Date();
  const zone = tz();
  const inScope = (/** @type {Goal} */ g) =>
    state.scope === 'archived' ? !!g.archived
      : state.scope === 'past' ? !g.archived && isExpired(g, now, zone)
      : !g.archived && !isExpired(g, now, zone);
  const goals = doc.goals.filter((g) => inScope(g) && (!state.filter || g.category === state.filter));

  if (!state.loaded && !state.fetchedAt) {
    main.append(h('p', { class: 'empty' }, state.cfg ? 'Loading goals…' : 'No data yet.'));
    return;
  }
  if (!goals.length) {
    const msg = state.scope === 'archived'
      ? 'No archived goals.'
      : state.scope === 'past'
        ? 'No past goals yet. One-off goals move here when their period or deadline ends.'
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
    for (const cat of doc.categories) {
      const list = goals.filter((g) => g.category === cat);
      if (!list.length) continue;
      list.sort((a, b) => HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon));
      groups.push([cat, '', list]);
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
function card(g, now) {
  const zone = tz();
  const key = goalKey(g, now, zone);
  const value = g.progress[key] ?? 0;
  const expired = isExpired(g, now, zone);
  const editable = canEdit() && !g.archived && !expired;
  const target = g.target && g.target > 0 ? g.target : null;
  const done = isDone(g, key);
  const when = g.horizon === 'deadline' ? 'Deadline' : g.repeat || expired ? HORIZON_SHORT[g.horizon] : HORIZON_LABEL[g.horizon];

  const chips = h(
    'div',
    { class: 'chips' },
    // Active: the view already groups by horizon or category, so the other one is shown.
    // Past and archived: single list, both are shown.
    state.scope !== 'active' || state.view === 'horizon' ? h('span', { class: 'chip' }, g.category) : null,
    state.scope !== 'active' || state.view === 'category' ? h('span', { class: 'chip muted' }, when) : null,
    g.repeat && state.scope === 'active' ? h('span', { class: 'chip muted' }, '↻ Repeats') : null,
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
      h('button', { class: 'btn', disabled: !canEdit(), onclick: () => dispatch({ type: 'archive', id: g.id, archived: false }) }, 'Restore'),
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
        h('button', { class: 'round', 'aria-label': 'Decrease', disabled: !editable || value <= 0, onclick: () => dispatch({ type: 'inc', id: g.id, key, delta: -1 }) }, '−'),
        h(
          'button',
          { class: 'value', disabled: !editable, title: 'Enter exact value', onclick: () => askValue(g, key, value) },
          `${fmt(value)} / ${fmt(target)}${g.unit ? ` ${g.unit}` : ''}`,
        ),
        h('button', { class: 'round', 'aria-label': 'Increase', disabled: !editable, onclick: () => dispatch({ type: 'inc', id: g.id, key, delta: 1 }) }, '+'),
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
          onclick: () => dispatch({ type: 'set', id: g.id, key, value: done ? 0 : 1 }),
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

/** Checkboxes of the sub-goals (in habits they are cleared when the period changes). @param {Goal} g @param {string} key @param {boolean} editable */
function subgoalList(g, key, editable) {
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
            h('input', { type: 'checkbox', checked: done, disabled: !editable, onchange: () => dispatch({ type: 'toggleSub', id: g.id, subId: s.id, key, done: !done }) }),
            h('span', {}, s.title),
          ),
        );
      }),
    ),
  );
}

/** @param {string} deadline @param {Date} now */
function deadlineChip(deadline, now) {
  const d = daysUntil(deadline, now, tz());
  const text = d > 1 ? `${d} days left` : d === 1 ? 'tomorrow' : d === 0 ? 'today' : `overdue by ${-d} ${d === -1 ? 'day' : 'days'}`;
  return h('span', { class: d < 0 ? 'chip danger' : d <= 7 ? 'chip warn' : 'chip' }, `${deadline} · ${text}`);
}

/** @param {Goal} g @param {string} key @param {number} value */
function askValue(g, key, value) {
  const input = prompt(`Value for “${g.title}” (${key})`, String(value));
  if (input === null) return;
  const n = Number(input.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return alert('Enter a number greater than or equal to 0.');
  dispatch({ type: 'set', id: g.id, key, value: n });
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
  const li = h('li', {});
  if (id) li.dataset.id = id;
  const input = h('input', { value: title, maxlength: 120, autocomplete: 'off', placeholder: 'Step towards the goal', 'aria-label': 'Sub-goal' });
  // Enter adds another row instead of submitting the form.
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    /** @type {HTMLButtonElement} */ ($('add-subgoal')).click();
  });
  li.append(input, h('button', { type: 'button', class: 'link danger', 'aria-label': 'Remove sub-goal', onclick: () => li.remove() }, 'Remove'));
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
    if (changedTarget) {
      state.pending = [];
      state.fetchedAt = null;
      state.loaded = false;
      persist();
    }
    dialog.close();
    refresh();
  };

  $('forget-token').onclick = () => {
    if (!confirm('Forget the token on this device? Unsaved changes will be lost.')) return;
    state.cfg = null;
    state.pending = [];
    state.loaded = false;
    lsSet(LS.cfg, null);
    lsSet(LS.cache, null);
    persist();
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

// ---------------------------------------------------------------- startup

function init() {
  state.cfg = lsGet(LS.cfg);
  const cache = lsGet(LS.cache);
  if (cache?.doc) {
    state.base = normalize(cache.doc);
    state.sha = cache.sha ?? null;
    state.fetchedAt = cache.fetchedAt ?? null;
  }
  state.pending = lsGet(LS.pending) ?? [];
  const ui = lsGet(LS.ui);
  if (ui) {
    state.view = ui.view === 'category' ? 'category' : 'horizon';
    state.filter = typeof ui.filter === 'string' ? ui.filter : '';
    state.scope = ['active', 'past', 'archived'].includes(ui.scope) ? ui.scope : ui.showArchived ? 'archived' : 'active';
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
  $('add').addEventListener('click', () => openGoalForm());
  $('refresh').addEventListener('click', refresh);
  $('settings').addEventListener('click', openSettings);
  $('manage').addEventListener('click', openManage);
  const goalForm = /** @type {HTMLFormElement} */ ($('goal-form'));
  goalForm.addEventListener('change', () => syncFormVisibility(goalForm));
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => /** @type {HTMLDialogElement} */ (btn.closest('dialog')).close());
  }

  window.addEventListener('online', () => { state.online = true; refresh(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (state.pending.length) flush();
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

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
