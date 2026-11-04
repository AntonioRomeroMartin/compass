// @ts-check
// Finance module (app side): on its area's page, the month's budget (spent against limit per category, income,
// expenses against the average and saved), the uncategorized movements (categorize one, and make it a rule), the
// month's movements and net worth (by kind, accounts, closed months); sheets for categories, limits and rules, and
// for an account's balance; the area's card on Home; and the progress of savings goals (goals whose `source` is
// "savings"). Everything here is sealed with the encryption password (lib/finance.js).
import * as financeLib from '../../../lib/finance.js';
import { canEdit, dispatchFinance, financeStore, goalSources, inAreas, passphrase, render, todayKey } from '../../core/data.js';
import { h, openSheet, sparkline } from '../../core/ui.js';

/** @typedef {import('../../../lib/finance.js').Movement} Movement */

const doc = () => financeStore.current();
const ready = () => !!passphrase() && financeStore.state.loaded;
/** Month shown on the page ('' = this one). */
let shownMonth = '';
const thisMonth = () => todayKey().slice(0, 7);

/** Does this area show the budget? (Its file names the area; locked without the password.) @param {Set<string>} ids */
export const hasFinance = (ids) => ready() && !!doc().domain && inAreas(ids, /** @type {string} */ (doc().domain));

/** @param {number} n @param {{ cents?: boolean }} [opts] */
export const eur = (n, opts = {}) => n.toLocaleString('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: opts.cents ? 2 : 0, minimumFractionDigits: opts.cents ? 2 : 0 });
/** "November 2026". @param {string} month */
const monthLabel = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** @param {string} month */
function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Net worth now. */
export const worthNow = () => financeLib.netWorth(doc());

// Savings goals: their progress is the net worth (or what it grew since the goal was set), up to a target that,
// like every figure, stays in this sealed file.
goalSources.savings = {
  kinds: [['networth', 'Net worth reaches the target (€)'], ['saved', 'Net worth grows by the target (€) from today']],
  available: ready,
  progress: (g) => {
    const p = ready() ? financeLib.savingProgress(doc(), g.id, worthNow().total) : null;
    return p && { value: Math.round(p.value), target: p.target };
  },
  get: (g) => doc().savings.find((s) => s.goal === g.id) ?? null,
  // "saved" counts from the net worth when it was first set so; changing its target keeps that start.
  save: (goal, kind, target) => {
    const old = doc().savings.find((s) => s.goal === goal);
    const base = kind !== 'saved' ? null : old?.kind === 'saved' && old.base !== null ? old.base : worthNow().total;
    dispatchFinance({ type: 'setSaving', saving: { goal, kind, target, base } });
  },
  remove: (goal) => dispatchFinance({ type: 'removeSaving', goal }),
};

// ---------------------------------------------------------------- the budget

/** @param {string} label @param {string} value @param {string} [cls] @param {string} [hint] */
const figure = (label, value, cls = '', hint = '') => h('div', { class: `figure ${cls}` }, h('b', {}, value), h('span', {}, label), hint ? h('span', { class: 'hint' }, hint) : null);

/** A bar of spent against limit: amber from 90%, red over the limit. @param {number} spent @param {number|null} limit */
function bar(spent, limit) {
  const fill = h('span');
  const pct = limit ? (spent / limit) * 100 : 0;
  fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (pct > 100) fill.className = 'over';
  else if (pct >= 90) fill.className = 'near';
  return h('div', { class: 'bar' }, fill);
}

/** @param {financeLib.Budget} b */
function budgetBlock(b) {
  return h('div', { class: 'budget' },
    h('div', { class: 'figures' },
      figure('spent', `${eur(b.spent)}${b.limit ? ` / ${eur(b.limit)}` : ''}`, b.limit && b.spent > b.limit ? 'down' : ''),
      figure('income', eur(b.income)),
      figure('expenses', eur(b.expenses), '', b.avgExpenses === null ? '' : `avg ${eur(b.avgExpenses)}`),
      figure('saved', eur(b.saved), b.saved < 0 ? 'down' : b.saved > 0 ? 'up' : '')),
    h('ul', { class: 'cat-list' }, ...b.categories.map((c) => h('li', { class: 'cat' },
      h('div', { class: 'cat-head' }, h('span', {}, c.name),
        h('span', { class: 'count' }, `${eur(c.spent)}${c.limit === null ? '' : ` / ${eur(c.limit)}`}`, c.avg === null ? null : h('span', { class: 'hint' }, ` · avg ${eur(c.avg)}`))),
      c.limit === null ? null : bar(c.spent, c.limit)))),
    b.categories.length ? null : h('p', { class: 'hint' }, 'No categories yet.'),
    h('button', { class: 'link', disabled: !canEdit(), onclick: openCategories }, 'Categories, limits and rules'));
}

/** @param {Movement} m @param {{ pick?: boolean }} [opts] */
function movementRow(m, opts = {}) {
  const cat = financeLib.categoryOf(doc(), m);
  const name = cat === financeLib.TRANSFER ? 'Transfer' : doc().categories.find((c) => c.id === cat)?.name ?? null;
  return h('li', { class: 'task' },
    h('button', { class: 'task-title', disabled: !canEdit(), onclick: () => openCategorize(m.id) },
      h('span', {}, m.text || '—'), h('span', { class: 'hint' }, ` · ${m.date.slice(8)}/${m.date.slice(5, 7)}`)),
    h('span', { class: 'task-meta' },
      name ? h('span', { class: 'chip muted' }, name) : opts.pick ? h('span', { class: 'chip warn' }, 'Pick') : null,
      h('span', { class: `amount ${m.amount > 0 ? 'up' : ''}` }, eur(m.amount, { cents: true }))));
}

// ---------------------------------------------------------------- net worth

function worthBlock() {
  const d = doc();
  const w = worthNow();
  const series = [...d.months].reverse().map((r) => r.total);
  const accounts = [...d.accounts].sort((a, b) => financeLib.KINDS.indexOf(/** @type {any} */ (a.kind)) - financeLib.KINDS.indexOf(/** @type {any} */ (b.kind)));
  return h('div', { class: 'worth' },
    h('div', { class: 'figures' }, figure('net worth', eur(w.total), w.total < 0 ? 'down' : ''),
      ...Object.entries(w.byKind).map(([k, v]) => figure(k === 'trading' ? 'Trading' : financeLib.KIND_TEXT[/** @type {financeLib.Kind} */ (k)] ?? k, eur(v), v < 0 ? 'down' : ''))),
    series.length ? h('figure', { class: 'curve' }, sparkline([...series, w.total].map((v) => v - series[0]), { label: `Net worth over ${series.length} closed months and now` }),
      h('figcaption', { class: 'hint' }, `Since ${monthLabel([...d.months].reverse()[0].month)} · one point per closed month, then now`)) : null,
    h('ul', { class: 'rows' },
      ...accounts.map((a) => h('li', { class: 'task' },
        h('button', { class: 'task-title', disabled: !canEdit(), onclick: () => openAccount(a.id) }, a.name, h('span', { class: 'hint' }, ` · ${financeLib.KIND_TEXT[a.kind]}`)),
        h('span', { class: 'task-meta' }, a.balance === null ? h('span', { class: 'chip warn' }, 'no balance')
          : h('span', { class: `amount ${a.kind === 'debt' ? 'down' : ''}` }, a.currency === 'EUR' ? eur(a.kind === 'debt' ? -a.balance : a.balance) : `${a.balance.toLocaleString('en-GB')} ${a.currency}`))))),
    h('button', { class: 'link', disabled: !canEdit(), onclick: () => openAccount(null) }, 'Add an account'));
}

// ---------------------------------------------------------------- the area's page and Home

/** @param {import('../index.js').AreaScope} _scope */
export function areaSections(_scope) {
  const month = shownMonth || thisMonth();
  const b = financeLib.budget(doc(), month);
  const all = doc().movements.filter((m) => m.date.startsWith(month));
  const go = (/** @type {string} */ m) => { shownMonth = m === thisMonth() ? '' : m; render(); };
  return [
    h('div', { class: 'month-nav' },
      h('button', { class: 'icon', 'aria-label': 'Previous month', onclick: () => go(financeLib.prevMonth(month)) }, '‹'),
      h('h3', {}, monthLabel(month)),
      h('button', { class: 'icon', 'aria-label': 'Next month', disabled: month >= thisMonth(), onclick: () => go(nextMonth(month)) }, '›')),
    budgetBlock(b),
    b.uncategorized.length ? h('section', { class: 'group sub-group' },
      h('h3', {}, 'Uncategorized', h('span', { class: 'sub' }, String(b.uncategorized.length))),
      h('ul', { class: 'rows' }, ...b.uncategorized.map((m) => movementRow(m, { pick: true })))) : null,
    all.length ? h('details', { class: 'group sub-group undated' },
      h('summary', {}, h('h3', {}, 'Movements', h('span', { class: 'sub' }, String(all.length)))),
      h('ul', { class: 'rows' }, ...all.map((m) => movementRow(m)))) : h('p', { class: 'hint' }, 'No movements this month: they come from the bank.'),
    h('section', { class: 'group sub-group' }, h('h3', {}, 'Net worth'), worthBlock()),
  ].filter((x) => x !== null);
}

/** The area's card on Home: spent of the budget this month, uncategorized, net worth. @param {import('../index.js').AreaScope} scope */
export function homeCard(scope) {
  if (!hasFinance(scope.ids)) return { stats: [], body: [] };
  const b = financeLib.budget(doc(), thisMonth());
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [
    [b.limit ? `of ${eur(b.limit)} spent` : 'spent', eur(b.spent), b.limit && b.spent > b.limit ? 'danger' : undefined],
    ['net worth', eur(worthNow().total)],
  ];
  if (b.uncategorized.length) stats.push(['uncategorized', b.uncategorized.length, 'warn']);
  const fill = h('span');
  fill.style.width = `${b.limit ? Math.min(100, (b.spent / b.limit) * 100) : 0}%`;
  if (b.limit && b.spent > b.limit) fill.className = 'over';
  return { stats, body: b.limit ? [h('div', { class: 'bar' }, fill)] : [] };
}

// ---------------------------------------------------------------- sheets

/** Pick a movement's category; optionally, a rule for every movement with the same text. @param {string} id */
function openCategorize(id) {
  openSheet((body, _redraw, close) => {
    const d = doc();
    const m = d.movements.find((x) => x.id === id);
    if (!m) return close();
    const current = financeLib.categoryOf(d, m);
    const match = h('input', { value: m.text, maxlength: 60, autocomplete: 'off', 'aria-label': 'Text the movements contain' });
    const always = h('input', { type: 'checkbox' });
    /** @param {string|null} cat */
    const pick = (cat) => {
      dispatchFinance({ type: 'categorize', id: m.id, category: cat });
      const text = match.value.trim();
      if (always.checked && cat && text) dispatchFinance({ type: 'addRule', rule: { id: financeLib.newId('r_'), match: text, category: cat } });
      close();
    };
    /** @type {[string, string][]} */
    const items = [...d.categories.map((c) => /** @type {[string, string]} */ ([c.id, c.name])), [financeLib.TRANSFER, 'Transfer (own accounts)']];
    body.append(
      h('h2', {}, m.text || 'Movement'),
      h('p', { class: 'hint' }, `${m.date} · ${eur(m.amount, { cents: true })}${m.account ? ` · ${m.account}` : ''}`),
      h('div', { class: 'chip-pick' }, ...items.map(([v, text]) => h('button', { type: 'button', class: 'chip-opt', role: 'radio', 'aria-checked': String(v === current), onclick: () => pick(v) }, text))),
      h('label', { class: 'check' }, always, 'Always, for movements that contain'),
      match,
      h('div', { class: 'actions' }, h('div', { class: 'extra' }, m.category ? h('button', { type: 'button', class: 'link', onclick: () => pick(null) }, 'Clear (use the rules)') : null),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel')),
    );
  }, { onClose: render });
}

/** Categories with their monthly limit (from this month on), and the rules. */
function openCategories() {
  openSheet((body, redraw) => {
    const d = doc();
    const month = thisMonth();
    const name = h('input', { placeholder: 'New category', maxlength: 40, autocomplete: 'off', 'aria-label': 'New category' });
    const add = () => {
      const n = name.value.trim();
      if (!n) return;
      let id = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
      while (d.categories.some((c) => c.id === id) || id === financeLib.TRANSFER) id += '-2';
      dispatchFinance({ type: 'addCategory', category: { id, name: n, limits: [] } });
      redraw();
    };
    body.append(
      h('h2', {}, 'Categories'),
      h('p', { class: 'hint' }, `A limit holds from ${monthLabel(month)} on; earlier months keep theirs.`),
      h('ul', { class: 'edit-list cats-edit' }, ...d.categories.map((c) => {
        const limit = h('input', { type: 'text', inputmode: 'decimal', value: financeLib.limitIn(c, month) ?? '', placeholder: 'No limit', 'aria-label': `Monthly limit of ${c.name}` });
        limit.addEventListener('change', () => {
          const raw = limit.value.trim().replace(',', '.');
          const n = Number(raw);
          if (raw && !(Number.isFinite(n) && n > 0)) return redraw();
          dispatchFinance({ type: 'setLimit', id: c.id, from: month, amount: raw ? n : null });
        });
        const rename = h('input', { value: c.name, maxlength: 40, 'aria-label': 'Name' });
        rename.addEventListener('change', () => { if (rename.value.trim()) dispatchFinance({ type: 'renameCategory', id: c.id, name: rename.value.trim() }); });
        return h('li', {}, rename, limit, h('button', { type: 'button', class: 'link danger', onclick: () => {
          if (!confirm(`Remove “${c.name}”? Its movements become uncategorized and its rules go.`)) return;
          dispatchFinance({ type: 'removeCategory', id: c.id });
          redraw();
        } }, 'Remove'));
      })),
      h('div', { class: 'search-row' }, name, h('button', { type: 'button', class: 'btn', onclick: add }, 'Add')),
      h('h2', {}, 'Rules'),
      d.rules.length ? h('ul', { class: 'mini-list' }, ...d.rules.map((r) => h('li', { class: 'mini' },
        h('span', { class: 'mini-title' }, `“${r.match}” → ${r.category === financeLib.TRANSFER ? 'Transfer' : d.categories.find((c) => c.id === r.category)?.name ?? r.category}`),
        h('button', { type: 'button', class: 'link danger', onclick: () => { dispatchFinance({ type: 'removeRule', id: r.id }); redraw(); } }, 'Remove'))))
        : h('p', { class: 'hint' }, 'None yet: categorize a movement and tick “Always”.'),
    );
    body.append(h('div', { class: 'actions' }, h('div', { class: 'extra' }), h('button', { type: 'button', class: 'btn primary', onclick: () => body.closest('dialog')?.close() }, 'Done')));
  }, { onClose: render });
}

/** An account's name, kind and balance (new with null). Bank balances will come from the bank. @param {string|null} id */
function openAccount(id) {
  openSheet((body, _redraw, close) => {
    const d = doc();
    const a = d.accounts.find((x) => x.id === id);
    const name = h('input', { value: a?.name ?? '', maxlength: 40, placeholder: 'Name', autocomplete: 'off' });
    const kind = h('select', {}, ...financeLib.KINDS.map((k) => h('option', { value: k, selected: (a?.kind ?? 'cash') === k }, financeLib.KIND_TEXT[k])));
    const balance = h('input', { type: 'text', inputmode: 'decimal', value: a?.balance ?? '', placeholder: 'Balance (a debt: what is owed)', autocomplete: 'off' });
    const currency = h('input', { value: a?.currency ?? 'EUR', maxlength: 5, autocomplete: 'off' });
    const rate = h('input', { type: 'text', inputmode: 'decimal', value: a && a.currency !== 'EUR' ? a.rate ?? '' : '', placeholder: '1 unit in €', autocomplete: 'off' });
    const address = h('input', { value: a?.address ?? '', placeholder: 'Public address (wallets)', autocomplete: 'off', spellcheck: false });
    const msg = h('p', { class: 'msg', role: 'status' });
    const save = () => {
      const n = name.value.trim();
      const bal = Number(balance.value.trim().replace(',', '.'));
      const cur = currency.value.trim().toUpperCase() || 'EUR';
      const r = Number(rate.value.trim().replace(',', '.'));
      if (!n) return void (msg.textContent = 'Give it a name.');
      if (balance.value.trim() && !Number.isFinite(bal)) return void (msg.textContent = 'The balance is a number.');
      if (cur !== 'EUR' && !(r > 0)) return void (msg.textContent = 'Other currencies need their rate to €.');
      const newId = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
      dispatchFinance({ type: 'setAccount', account: {
        id: a?.id ?? (d.accounts.some((x) => x.id === newId) ? financeLib.newId('a_') : newId), name: n, kind: /** @type {financeLib.Kind} */ (kind.value),
        currency: cur, balance: balance.value.trim() ? bal : null, rate: cur === 'EUR' ? 1 : r, at: new Date().toISOString(), address: address.value.trim() || null,
      } });
      close();
    };
    body.append(
      h('h2', {}, a ? a.name : 'New account'),
      h('label', {}, 'Name', name), h('label', {}, 'Kind', kind), h('label', {}, 'Balance', balance),
      h('div', { class: 'two' }, h('label', {}, 'Currency', currency), h('label', {}, 'Rate to €', rate)),
      h('label', {}, 'Address', address),
      a?.at ? h('p', { class: 'hint' }, `Balance of ${new Date(a.at).toLocaleString('en-GB')}`) : null,
      msg,
      h('div', { class: 'actions' },
        h('div', { class: 'extra' }, a ? h('button', { type: 'button', class: 'link danger', onclick: () => {
          if (!confirm(`Remove “${a.name}” from net worth?`)) return;
          dispatchFinance({ type: 'removeAccount', id: a.id });
          close();
        } }, 'Remove…') : null),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save')),
    );
  }, { onClose: render });
}
