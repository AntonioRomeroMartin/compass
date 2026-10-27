// @ts-check
// App state and the synced data files (one store per file), shared by every view and module.
import * as goalsLib from '../../lib/goals.js';
import * as tasksLib from '../../lib/tasks.js';
import * as domainsLib from '../../lib/domains.js';
import * as habitsLib from '../../lib/habits.js';
import { createStore } from './store.js';
import { lsSet } from './ui.js';
import { emptyDoc } from '../../lib/goals.js';
import { deviceTimeZone, isValidTimeZone, periodKey } from '../../lib/period.js';

/** @typedef {import('../../lib/github.js').RepoConfig} RepoConfig */
/** @typedef {'home'|'today'|'areas'|'goals'|'habits'|'more'} Tab */

// localStorage keys keep the "goals." prefix of the first version, so existing devices keep their settings.
export const LS = { cfg: 'goals.cfg', ui: 'goals.ui', theme: 'compass.theme' };

export const state = {
  /** @type {RepoConfig|null} */
  cfg: null,
  /** @type {Tab} */
  tab: 'home',
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
  /** sidebar: the areas tree is open, and the areas whose sub-areas are unfolded */
  navOpen: false,
  /** @type {string[]} */
  navExpanded: [],
};

export function persist() {
  lsSet(LS.ui, { tab: state.tab, view: state.view, filter: state.filter, scope: state.scope, undatedOpen: state.undatedOpen, area: state.area, subArea: state.subArea, navOpen: state.navOpen, navExpanded: state.navExpanded });
}

const cfg = () => state.cfg;

// The goals file must exist (settings create it); tasks.json and domains.json are created next to it on the first save.
export const goalsStore = createStore({ mod: goalsLib, file: '', ls: 'goals', empty: () => emptyDoc(), cfg, onChange: () => render(), required: true });

export const tasksStore = createStore({ mod: tasksLib, file: 'tasks.json', ls: 'compass.tasks', empty: () => tasksLib.emptyDoc(goalsStore.current().timeZone), cfg, onChange: () => render(), ready: () => goalsStore.state.loaded });

export const domainsStore = createStore({ mod: domainsLib, file: 'domains.json', ls: 'compass.domains', empty: () => domainsLib.emptyDoc(), cfg, onChange: () => render(), ready: () => goalsStore.state.loaded });

export const habitsStore = createStore({ mod: habitsLib, file: 'habits.json', ls: 'compass.habits', empty: () => habitsLib.emptyDoc(goalsStore.current().timeZone), cfg, onChange: () => render(), ready: () => goalsStore.state.loaded });

export const STORES = [goalsStore, tasksStore, domainsStore, habitsStore];

export const current = () => goalsStore.current();

/** Time zone of the periods: the goals file's; if it has none, the device's. */
export const tz = () => {
  const zone = current().timeZone;
  return isValidTimeZone(zone) ? zone : deviceTimeZone();
};

export const online = () => navigator.onLine && STORES.every((st) => st.state.online);

export const loaded = () => STORES.every((st) => st.state.loaded);

export const canEdit = () => online() && goalsStore.state.loaded && !!state.cfg;

export async function refresh() {
  if (!state.cfg) return;
  await Promise.all(STORES.map((st) => st.refresh()));
}

/** @param {...Op} ops */
export function dispatchGoals(...ops) {
  if (!canEdit() || !ops.length) return;
  goalsStore.dispatch(ops);
}

/** @param {...import('../../lib/habits.js').Op} ops */
export function dispatchHabits(...ops) {
  if (!canEdit() || !ops.length) return;
  habitsStore.dispatch(ops);
}

/** Civil date of today in the data's time zone. */
export const todayKey = () => periodKey('day', new Date(), tz());

/** An area and all its sub-areas. @param {string} id */
export function areaIds(id) {
  return new Set([id, ...domainsLib.descendants(domainsStore.current(), id)]);
}

/** Does a task's domain or a goal's category fall in these areas? @param {Set<string>} ids @param {string} text */
export const inAreas = (ids, text) => ids.has(domainsLib.canonical(domainsStore.current(), text));

/** Redraws the screen; set by app.js (stores and views call it after a change). */
let renderer = () => {};
export const render = () => renderer();
/** @param {() => void} fn */
export const setRender = (fn) => { renderer = fn; };
