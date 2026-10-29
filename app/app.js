// @ts-check
import { LS, STORES, canEdit, current, goalsStore, loaded, online, persist, refresh, render, setRender, state, tz } from './core/data.js';
import { $, h, lsGet, lsSet } from './core/ui.js';
import { openGoalForm, openManage, renderList, renderToolbar, syncFormVisibility } from './modules/goals/view.js';
import { openTaskForm } from './modules/tasks/view.js';
import { openHabitForm } from './modules/habits/view.js';
import { renderHabitsView } from './views/habits.js';
import { renderAreas, renderNavAreas } from './views/areas.js';
import { GOALS_FILE, openSettings } from './views/settings.js';
import { renderHome } from './views/home.js';
import { renderTodayView } from './views/today.js';
import { civilDate, periodKeys } from '../lib/period.js';

/** @typedef {'home'|'today'|'areas'|'goals'|'habits'|'more'} Tab */

/** @type {Tab[]} */
const TABS = ['home', 'today', 'areas', 'goals', 'habits', 'more'];

/** @type {Record<Tab, string>} */
const TAB_TITLE = { home: 'Home', today: 'Today', areas: 'Areas', goals: 'Goals', habits: 'Habits', more: 'More' };

function renderAll() {
  renderTabs();
  renderDate();
  renderStatus();
  if (state.tab === 'home') renderHome();
  if (state.tab === 'today') renderTodayView();
  if (state.tab === 'areas') renderAreas();
  if (state.tab === 'habits') renderHabitsView();
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
  if (state.tab === 'more') $('open-more').setAttribute('aria-current', 'page');
  else $('open-more').removeAttribute('aria-current');
  for (const sec of document.querySelectorAll('[data-view-of]')) {
    /** @type {HTMLElement} */ (sec).hidden = /** @type {HTMLElement} */ (sec).dataset.viewOf !== state.tab;
  }
  $('page-title').textContent = TAB_TITLE[state.tab];
  renderNavAreas();
}

/** @param {Tab} tab */
function go(tab) {
  if (tab === 'areas') {
    // "Areas" opens the list of areas and opens or closes their tree in the sidebar.
    state.navOpen = !state.navOpen;
    state.area = '';
  }
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

function init() {
  applyTheme(lsGet(LS.theme));
  $('theme').addEventListener('click', () => {
    const next = shownTheme() === 'dark' ? 'light' : 'dark';
    lsSet(LS.theme, next);
    applyTheme(next);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(lsGet(LS.theme)));
  // Connections saved by older versions may name another path (data/goals.json): the files are at the root.
  const saved = lsGet(LS.cfg);
  state.cfg = saved && { ...saved, path: GOALS_FILE };
  const ui = lsGet(LS.ui);
  if (ui) {
    state.view = ui.view === 'category' ? 'category' : 'horizon';
    state.filter = typeof ui.filter === 'string' ? ui.filter : '';
    state.scope = ['active', 'past', 'archived'].includes(ui.scope) ? ui.scope : ui.showArchived ? 'archived' : 'active';
    if (TABS.includes(ui.tab)) state.tab = ui.tab;
    state.undatedOpen = ui.undatedOpen === true;
    state.area = typeof ui.area === 'string' ? ui.area : '';
    state.subArea = typeof ui.subArea === 'string' ? ui.subArea : '';
    state.navOpen = ui.navOpen === true;
    state.navExpanded = Array.isArray(ui.navExpanded) ? ui.navExpanded.filter((x) => typeof x === 'string') : [];
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
  // Task · Goal · Habit switch at the top of a new item's sheet.
  for (const btn of document.querySelectorAll('[data-switch]')) {
    btn.addEventListener('click', () => {
      /** @type {HTMLDialogElement} */ (btn.closest('dialog')).close();
      const kind = /** @type {HTMLElement} */ (btn).dataset.switch;
      if (kind === 'goal') openGoalForm();
      else if (kind === 'habit') openHabitForm();
      else openTaskForm();
    });
  }
  $('refresh').addEventListener('click', refresh);
  $('open-more').addEventListener('click', () => go('more'));
  $('settings').addEventListener('click', openSettings);
  $('manage').addEventListener('click', openManage);
  $('open-manage').addEventListener('click', openManage);
  $('task-dialog').addEventListener('close', () => render());
  $('habit-dialog').addEventListener('close', () => render());
  $('habit-cal-dialog').addEventListener('close', () => render());
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
  // Every minute while it is on screen: fetch what other devices or the agent changed, and redraw
  // when the day or week changes (in the file's time zone).
  let lastKeys = JSON.stringify(periodKeys(new Date(), tz()));
  setInterval(() => {
    const keys = JSON.stringify(periodKeys(new Date(), tz()));
    if (keys !== lastKeys) { lastKeys = keys; render(); }
    if (document.visibilityState === 'visible' && state.cfg) refresh();
  }, 60000);

  render();
  if (state.cfg) refresh();
  else openSettings();

  // Not on a local preview: there every reload must show the files as they are now.
  if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

setRender(renderAll);
init();
