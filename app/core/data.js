// @ts-check
// App state and the synced data files (one store per file), shared by every view and module.
import * as goalsLib from '../../lib/goals.js';
import * as tasksLib from '../../lib/tasks.js';
import * as domainsLib from '../../lib/domains.js';
import * as habitsLib from '../../lib/habits.js';
import * as booksLib from '../../lib/books.js';
import * as journalLib from '../../lib/journal.js';
import * as tradesLib from '../../lib/trades.js';
import { isSealed, open, seal } from '../../lib/crypt.js';
import { createStore } from './store.js';
import { lsGet, lsSet } from './ui.js';
import { emptyDoc } from '../../lib/goals.js';
import { deviceTimeZone, isValidTimeZone, periodKey } from '../../lib/period.js';

/** @typedef {import('../../lib/github.js').RepoConfig} RepoConfig */
/** @typedef {'home'|'today'|'areas'|'goals'|'habits'|'books'|'journal'|'more'} Tab */

// localStorage keys keep the "goals." prefix of the first version, so existing devices keep their settings.
export const LS = { cfg: 'goals.cfg', ui: 'goals.ui', theme: 'compass.theme', passphrase: 'compass.passphrase' };

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
  /** day open on the Journal page ('' = today) and the text searched there */
  journalDate: '',
  journalQuery: '',
  /** the Areas list is in edit mode (not kept across reloads) */
  areasEdit: false,
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

export const booksStore = createStore({ mod: booksLib, file: 'books.json', ls: 'compass.books', empty: () => booksLib.emptyDoc(goalsStore.current().timeZone), cfg, onChange: () => render(), ready: () => goalsStore.state.loaded });

export const STORES = [goalsStore, tasksStore, domainsStore, habitsStore, booksStore];

/** The encryption password of this device (one for every sealed file), or null. */
export const passphrase = () => /** @type {string|null} */ (lsGet(LS.passphrase));

/**
 * A file sealed with the encryption password (journal, trades): without the password on this device it is
 * neither read nor written. Sealed stores are not in STORES: their errors (a wrong password) show in their own blocks,
 * not in the banner.
 * @template D, O
 * @param {import('./store.js').Module<D, O>} mod @param {string} file @param {string} ls @param {() => D} empty
 */
function sealedStore(mod, file, ls, empty) {
  /** Salt as last read: kept on write, so the key is not derived again. @type {string|null} */
  let salt = null;
  const store = createStore({
    mod, file, ls, empty, cfg, onChange: () => render(), ready: () => goalsStore.state.loaded, active: () => !!passphrase(),
    codec: {
      decode: async (text) => {
        const raw = JSON.parse(text);
        if (!isSealed(raw)) throw new Error(`${file} is not encrypted, so it is not opened.`);
        const opened = await open(raw, /** @type {string} */ (passphrase()));
        salt = opened.salt;
        return opened.text;
      },
      encode: (text) => seal(text, /** @type {string} */ (passphrase()), salt),
    },
  });
  return Object.assign(store, { forgetSalt: () => { salt = null; } });
}

export const journalStore = sealedStore(journalLib, 'journal.json', 'compass.journal', () => journalLib.emptyDoc(goalsStore.current().timeZone));

export const tradesStore = sealedStore(tradesLib, 'trades.json', 'compass.trades', () => tradesLib.emptyDoc(goalsStore.current().timeZone));

const SEALED = [journalStore, tradesStore];

/** Every store, the sealed ones too (to save pending changes or retry). */
export const ALL_STORES = [...STORES, ...SEALED];

/** Sets (or, with null, forgets) this device's encryption password and reads the sealed files again with it. @param {string|null} pass */
export function setPassphrase(pass) {
  lsSet(LS.passphrase, pass);
  for (const st of SEALED) {
    st.forgetSalt();
    st.reset();
    st.refresh();
  }
  render();
}

export const current = () => goalsStore.current();

/** Time zone of the periods: the goals file's; if it has none, the device's. */
export const tz = () => {
  const zone = current().timeZone;
  return isValidTimeZone(zone) ? zone : deviceTimeZone();
};

export const online = () => navigator.onLine && STORES.every((st) => st.state.online);

export const loaded = () => STORES.every((st) => st.state.loaded);

// Offline too, on the copy saved on this device: the changes wait in the device and are uploaded when back online.
export const canEdit = () => !!state.cfg && (goalsStore.state.loaded || !!goalsStore.state.fetchedAt);

export async function refresh() {
  if (!state.cfg) return;
  await Promise.all(ALL_STORES.map((st) => st.refresh()));
}

/** @param {...Op} ops */
export function dispatchGoals(...ops) {
  if (!canEdit() || !ops.length) return;
  goalsStore.dispatch(ops);
}

/** @param {...import('../../lib/domains.js').Op} ops */
export function dispatchDomains(...ops) {
  if (!canEdit() || !ops.length) return;
  domainsStore.dispatch(ops);
}

/** @param {...import('../../lib/habits.js').Op} ops */
export function dispatchHabits(...ops) {
  if (!canEdit() || !ops.length) return;
  habitsStore.dispatch(ops);
}

/** @param {...import('../../lib/books.js').Op} ops */
export function dispatchBooks(...ops) {
  if (!canEdit() || !ops.length) return;
  booksStore.dispatch(ops);
}

/** @param {...import('../../lib/journal.js').Op} ops */
export function dispatchJournal(...ops) {
  if (!canEdit() || !ops.length) return;
  journalStore.dispatch(ops);
}

/** @param {...import('../../lib/trades.js').Op} ops */
export function dispatchTrades(...ops) {
  if (!canEdit() || !ops.length) return;
  tradesStore.dispatch(ops);
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
