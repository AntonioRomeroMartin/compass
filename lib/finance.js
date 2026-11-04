// @ts-check
// Data model of finance.json and edit operations (same shape as the other data files: normalize, applyOps
// re-applied on the latest version, serialize, commitMessage), plus the monthly budget, net worth and savings.
// The file is sealed with the user's passphrase (lib/crypt.js): this module only sees it open.
//
// Money is in EUR. Movements come from the bank (later, through an aggregator) into an account. A movement's
// category is the one set on it, or else the first rule whose text it contains; with neither it is
// "uncategorized". Transfers between one's own accounts (bank ↔ exchange too) have the category TRANSFER and stay
// out of the budget. A category's monthly limit holds from the month it is set. Net worth adds the accounts (debts
// subtract); the trading accounts join it with the exchanges' import (lib/trades.js), not before. One row per month,
// written when the next one is first opened (dueClose), keeps its history.
// Commit messages are not encrypted, so they only count changes, never names or figures.

import { isDate, isValidTimeZone } from './period.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

/** The category of transfers between one's own accounts (out of the budget). */
export const TRANSFER = 'transfer';

/** @typedef {'bank'|'cash'|'defi'|'debt'|'other'} Kind */
/** @type {Record<Kind, string>} */
export const KIND_TEXT = { bank: 'Bank', cash: 'Cash', defi: 'DeFi', debt: 'Debt', other: 'Other' };
/** The kinds of account, in the order they are shown. */
export const KINDS = /** @type {const} */ (['bank', 'cash', 'defi', 'other', 'debt']);

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {{ from: string, amount: number|null }[]} limits  monthly limit from a month ("YYYY-MM") on; null = none
 */

/**
 * A movement whose text contains `match` (any case) gets `category`.
 * @typedef {{ id: string, match: string, category: string }} Rule
 */

/**
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} name
 * @property {Kind} kind
 * @property {string} currency
 * @property {number|null} balance   a debt is a positive balance that subtracts
 * @property {number|null} rate      1 unit of the currency in EUR (1 for EUR)
 * @property {string|null} at        ISO 8601 of the balance
 * @property {string|null} address   public address of a wallet (DeFi)
 */

/**
 * @typedef {Object} Movement
 * @property {string} id
 * @property {string|null} extId     the bank's id (imports skip what is already there)
 * @property {string} account
 * @property {string} date           YYYY-MM-DD
 * @property {number} amount         + in, − out
 * @property {string} text           merchant or concept
 * @property {string|null} category  set by hand (wins over the rules); TRANSFER for one's own transfers
 */

/** @typedef {{ month: string, total: number, byKind: Record<string, number> }} MonthRow */

/**
 * A savings goal's figures (the goal itself is in the goals file; here, what must stay encrypted).
 * kind "networth": reach `target` of net worth; "saved": add `target` to the net worth it had when created (`base`).
 * @typedef {{ goal: string, kind: 'networth'|'saved', target: number, base: number|null }} Saving
 */

/**
 * @typedef {Object} FinanceDoc
 * @property {number} version
 * @property {string} [timeZone]
 * @property {string|null} domain    area whose page shows the budget
 * @property {string} currency       EUR
 * @property {Category[]} categories
 * @property {Rule[]} rules
 * @property {Account[]} accounts
 * @property {Movement[]} movements  latest first
 * @property {MonthRow[]} months     latest first
 * @property {Saving[]} savings
 */

/**
 * @typedef {{ type: 'addCategory', category: Category }
 *   | { type: 'renameCategory', id: string, name: string }
 *   | { type: 'setLimit', id: string, from: string, amount: number|null }
 *   | { type: 'removeCategory', id: string }
 *   | { type: 'addRule', rule: Rule }
 *   | { type: 'removeRule', id: string }
 *   | { type: 'setAccount', account: Account }
 *   | { type: 'removeAccount', id: string }
 *   | { type: 'addMovement', movement: Movement }
 *   | { type: 'categorize', id: string, category: string|null }
 *   | { type: 'deleteMovement', id: string }
 *   | { type: 'closeMonth', row: MonthRow, ifMissing?: boolean }
 *   | { type: 'setSaving', saving: Saving }
 *   | { type: 'removeSaving', goal: string }
 *   | { type: 'setDomain', domain: string|null }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** @param {string} [timeZone] @returns {FinanceDoc} */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), domain: null, currency: 'EUR', categories: [], rules: [], accounts: [], movements: [], months: [], savings: [] };
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** @param {unknown} v @returns {number|null} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** @param {unknown} v @returns {v is string} */
const isMonth = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
/** @param {any} x @returns {Account|null} */
function normAccount(x) {
  if (!x || typeof x.id !== 'string') return null;
  const currency = textOrNull(x.currency) ?? 'EUR';
  const rate = num(x.rate);
  return {
    id: x.id, name: textOrNull(x.name) ?? x.id, kind: x.kind in KIND_TEXT ? x.kind : 'bank', currency, balance: num(x.balance),
    rate: rate !== null && rate > 0 ? rate : currency === 'EUR' ? 1 : null,
    at: typeof x.at === 'string' && !Number.isNaN(Date.parse(x.at)) ? x.at : null, address: textOrNull(x.address),
  };
}
/** @param {any} x @returns {Movement|null} */
function normMovement(x) {
  if (!x || typeof x.id !== 'string' || !isDate(x.date) || num(x.amount) === null) return null;
  return { id: x.id, extId: textOrNull(x.extId), account: textOrNull(x.account) ?? '', date: x.date, amount: x.amount, text: textOrNull(x.text) ?? '', category: textOrNull(x.category) };
}
/** @param {Movement} a @param {Movement} b */
const byDateDesc = (a, b) => b.date.localeCompare(a.date);

/**
 * Normalizes a document that was read (tolerates missing fields; drops what is unusable).
 * @param {any} raw
 * @returns {FinanceDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  /** @template T @param {any} list @param {(x: any) => T|null} fn @returns {T[]} */
  const each = (list, fn) => (Array.isArray(list) ? list : []).map(fn).filter((x) => x !== null);
  return {
    ...doc, version: Number(doc.version) || 1, domain: textOrNull(doc.domain), currency: textOrNull(doc.currency) ?? 'EUR',
    categories: each(doc.categories, (c) => (c && typeof c.id === 'string' && textOrNull(c.name) ? {
      id: c.id, name: c.name.trim(),
      limits: each(c.limits, (l) => (l && isMonth(l.from) ? { from: l.from, amount: num(l.amount) } : null)).sort((a, b) => a.from.localeCompare(b.from)),
    } : null)),
    rules: each(doc.rules, (r) => (r && typeof r.id === 'string' && textOrNull(r.match) && textOrNull(r.category) ? { id: r.id, match: r.match.trim(), category: r.category } : null)),
    accounts: each(doc.accounts, normAccount),
    movements: each(doc.movements, normMovement).sort(byDateDesc),
    months: each(doc.months, (m) => (m && isMonth(m.month) && num(m.total) !== null ? {
      month: m.month, total: m.total,
      byKind: Object.fromEntries(Object.entries(m.byKind ?? {}).filter(([, v]) => num(v) !== null)),
    } : null)).sort((a, b) => b.month.localeCompare(a.month)),
    savings: each(doc.savings, (s) => (s && typeof s.goal === 'string' && num(s.target) !== null ? {
      goal: s.goal, kind: s.kind === 'saved' ? 'saved' : 'networth', target: s.target, base: num(s.base),
    } : null)),
  };
}

// ---------------------------------------------------------------- budget

/** A movement's category: its own, else the first matching rule, else null (uncategorized). @param {FinanceDoc} doc @param {Movement} m */
export function categoryOf(doc, m) {
  if (m.category) return m.category;
  const text = m.text.toLowerCase();
  return doc.rules.find((r) => text.includes(r.match.toLowerCase()))?.category ?? null;
}

/** A category's limit in a month (the last one set from that month or before). @param {Category} c @param {string} month */
export const limitIn = (c, month) => c.limits.filter((l) => l.from <= month).at(-1)?.amount ?? null;

/** The month before. @param {string} month YYYY-MM */
export function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * @typedef {Object} Budget
 * @property {string} month
 * @property {{ id: string, name: string, spent: number, limit: number|null, avg: number|null }[]} categories
 * @property {number} spent    spent in the categories
 * @property {number} limit    sum of the limits
 * @property {number} income   in, transfers left out
 * @property {number} expenses out, transfers left out
 * @property {number} saved    income − expenses
 * @property {number|null} avgExpenses  average of the previous months with movements (up to 3)
 * @property {Movement[]} uncategorized
 */

/** How many earlier months the averages look at. */
export const AVG_MONTHS = 3;

/**
 * The budget of a month: spent against limit per category, income, expenses and saved, against the average of the
 * previous months that have movements.
 * @param {FinanceDoc} doc @param {string} month YYYY-MM
 * @returns {Budget}
 */
export function budget(doc, month) {
  /** @param {string} mo */
  const of = (mo) => doc.movements.filter((m) => m.date.startsWith(mo)).map((m) => ({ m, cat: categoryOf(doc, m) })).filter((x) => x.cat !== TRANSFER);
  const now = of(month);
  /** @type {string[]} */
  const earlier = [];
  const oldest = doc.movements.at(-1)?.date.slice(0, 7) ?? month;
  for (let mo = prevMonth(month); earlier.length < AVG_MONTHS && mo >= oldest; mo = prevMonth(mo)) if (of(mo).length) earlier.push(mo);
  const past = earlier.map(of);
  /** @param {{ m: Movement, cat: string|null }[]} xs @param {string} id */
  const spentIn = (xs, id) => 0 - xs.filter((x) => x.cat === id).reduce((s, x) => s + x.m.amount, 0);
  /** @param {{ m: Movement }[]} xs */
  const outOf = (xs) => 0 - xs.filter((x) => x.m.amount < 0).reduce((s, x) => s + x.m.amount, 0);
  /** @param {number[]} xs */
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const categories = doc.categories.map((c) => ({
    id: c.id, name: c.name, spent: spentIn(now, c.id), limit: limitIn(c, month), avg: avg(past.map((xs) => spentIn(xs, c.id))),
  }));
  const income = now.filter((x) => x.m.amount > 0).reduce((s, x) => s + x.m.amount, 0);
  const expenses = outOf(now);
  return {
    month, categories, spent: categories.reduce((s, c) => s + c.spent, 0), limit: categories.reduce((s, c) => s + (c.limit ?? 0), 0),
    income, expenses, saved: income - expenses, avgExpenses: avg(past.map(outOf)),
    uncategorized: now.filter((x) => x.m.amount < 0 && (x.cat === null || !doc.categories.some((c) => c.id === x.cat))).map((x) => x.m),
  };
}

// ---------------------------------------------------------------- net worth and savings

/**
 * Net worth now, in EUR: the accounts by kind (debts subtract; accounts without a rate are left out).
 * @param {FinanceDoc} doc
 * @returns {{ total: number, byKind: Record<string, number> }}
 */
export function netWorth(doc) {
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const a of doc.accounts) {
    if (a.balance === null || !a.rate) continue;
    byKind[a.kind] = (byKind[a.kind] ?? 0) + (a.kind === 'debt' ? -Math.abs(a.balance) : a.balance) * a.rate;
  }
  return { total: Object.values(byKind).reduce((a, b) => a + b, 0), byKind };
}

/**
 * The row of last month, when it is due: the first time finance is opened in a month whose previous one has no row
 * (and there are balances to count), it keeps the net worth of that moment. Null when nothing is due.
 * @param {FinanceDoc} doc @param {string} month  this month, YYYY-MM
 * @returns {Op|null}
 */
export function dueClose(doc, month) {
  const prev = prevMonth(month);
  if (doc.months.some((m) => m.month === prev) || !doc.accounts.some((a) => a.balance !== null)) return null;
  const w = netWorth(doc);
  return { type: 'closeMonth', row: { month: prev, total: w.total, byKind: w.byKind }, ifMissing: true };
}

/**
 * Progress of a savings goal: the net worth (or what it grew since the goal was created) and its target.
 * @param {FinanceDoc} doc @param {string} goal @param {number} total  net worth now
 * @returns {{ value: number, target: number }|null}
 */
export function savingProgress(doc, goal, total) {
  const s = doc.savings.find((x) => x.goal === goal);
  if (!s) return null;
  return { value: Math.max(0, s.kind === 'saved' ? total - (s.base ?? total) : total), target: s.target };
}

// ---------------------------------------------------------------- operations

/** Is this movement already there? Same bank id, or else same account, day, amount and text. @param {FinanceDoc} doc @param {Movement} m */
export const isDuplicate = (doc, m) => doc.movements.some((x) => x.id === m.id || (x.account === m.account && (m.extId
  ? x.extId === m.extId
  : !x.extId && x.date === m.date && x.amount === m.amount && x.text === m.text)));

/**
 * Applies operations to a copy of the document; operations on things that no longer exist are ignored.
 * @param {FinanceDoc} doc
 * @param {Op[]} ops
 * @returns {FinanceDoc}
 */
export function applyOps(doc, ops) {
  /** @type {FinanceDoc} */
  const out = structuredClone(doc);
  for (const op of ops) {
    switch (op.type) {
      case 'addCategory':
        if (!out.categories.some((c) => c.id === op.category.id)) out.categories.push(structuredClone(op.category));
        break;
      case 'renameCategory': {
        const c = out.categories.find((x) => x.id === op.id);
        if (c && op.name.trim()) c.name = op.name.trim();
        break;
      }
      case 'setLimit': {
        const c = out.categories.find((x) => x.id === op.id);
        if (c && isMonth(op.from)) c.limits = [...c.limits.filter((l) => l.from !== op.from), { from: op.from, amount: op.amount }].sort((a, b) => a.from.localeCompare(b.from));
        break;
      }
      case 'removeCategory':
        out.categories = out.categories.filter((c) => c.id !== op.id);
        out.rules = out.rules.filter((r) => r.category !== op.id);
        for (const m of out.movements) if (m.category === op.id) m.category = null;
        break;
      case 'addRule':
        if (!out.rules.some((r) => r.id === op.rule.id)) out.rules.push(structuredClone(op.rule));
        break;
      case 'removeRule':
        out.rules = out.rules.filter((r) => r.id !== op.id);
        break;
      case 'setAccount': {
        const a = normAccount(op.account);
        if (a) out.accounts = [...out.accounts.filter((x) => x.id !== a.id), a];
        break;
      }
      case 'removeAccount':
        out.accounts = out.accounts.filter((x) => x.id !== op.id);
        break;
      case 'addMovement': {
        const m = normMovement(op.movement);
        if (m && !isDuplicate(out, m)) out.movements.push(m);
        break;
      }
      case 'categorize': {
        const m = out.movements.find((x) => x.id === op.id);
        if (m) m.category = op.category;
        break;
      }
      case 'deleteMovement':
        out.movements = out.movements.filter((x) => x.id !== op.id);
        break;
      case 'closeMonth':
        // ifMissing: written on its own when a month is first opened, so it never replaces a row already there.
        if (op.ifMissing && out.months.some((m) => m.month === op.row.month)) break;
        if (isMonth(op.row.month)) out.months = [...out.months.filter((m) => m.month !== op.row.month), structuredClone(op.row)];
        break;
      case 'setSaving':
        out.savings = [...out.savings.filter((s) => s.goal !== op.saving.goal), structuredClone(op.saving)];
        break;
      case 'removeSaving':
        out.savings = out.savings.filter((s) => s.goal !== op.goal);
        break;
      case 'setDomain':
        out.domain = op.domain;
        break;
      case 'setTimeZone':
        if (isValidTimeZone(op.timeZone)) out.timeZone = op.timeZone;
        break;
    }
  }
  out.movements.sort(byDateDesc);
  out.months.sort((a, b) => b.month.localeCompare(a.month));
  return out;
}

/**
 * Commit message for a batch of operations: what changed, counted (no names or figures: they are not encrypted).
 * @param {Op[]} ops
 */
export function commitMessage(ops) {
  /** @type {Record<string, number>} */
  const n = {};
  for (const op of ops) n[op.type] = (n[op.type] ?? 0) + 1;
  const parts = [];
  if (n.addMovement) parts.push(`${n.addMovement} movement${n.addMovement > 1 ? 's' : ''}`);
  if (n.categorize) parts.push(`${n.categorize} categorized`);
  if (n.deleteMovement) parts.push(`${n.deleteMovement} deleted`);
  if (n.addCategory || n.renameCategory || n.setLimit || n.removeCategory) parts.push('categories');
  if (n.addRule || n.removeRule) parts.push('rules');
  if (n.setAccount || n.removeAccount) parts.push('accounts');
  if (n.closeMonth) parts.push('month closed');
  if (n.setSaving || n.removeSaving) parts.push('savings');
  if (n.setDomain) parts.push('area');
  if (n.setTimeZone) parts.push('time zone');
  return `finance: ${parts.join(', ') || 'update'}`;
}
