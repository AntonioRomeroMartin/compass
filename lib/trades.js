// @ts-check
// Data model of trades.json and edit operations (same shape as the other data files: normalize, applyOps
// re-applied on the latest version, serialize, commitMessage), plus the figures of the trading panel and the
// risk limits. The file is sealed with the user's passphrase (lib/crypt.js): this module only sees it open.
//
// A trade comes from an exchange (its API, later) with what the exchange knows: market, symbol, side, size, prices
// and times, leverage, fees, funding and net PnL. The trader adds what it does not know: the initial stop (the
// order's stop is proposed), setup and timeframe, target, emotion 1-5, discipline errors and notes.
// Results are measured in R: 1 R is what the trade loses if the initial stop is hit, |entry − stop| × size.
// Money is in the doc's currency (USD); each account snapshot carries its USD→EUR rate for net worth.
// Commit messages are not encrypted, so they only count trades, never symbols or figures.

import { isValidTimeZone, periodKey } from './period.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

/** @typedef {'spot'|'perp'|'stock'} Market */
/** @typedef {'long'|'short'} Side */

/** @type {Record<Market, string>} */
export const MARKET_TEXT = { spot: 'Crypto spot', perp: 'Perpetual', stock: 'Stock / ETF' };

/** The error a trade gets by itself when it was opened after a risk limit was hit. */
export const LIMIT_ERROR = 'Over a limit';

/**
 * @typedef {Object} Trade
 * @property {string} id
 * @property {string|null} extId      the exchange's id (imports skip what is already there)
 * @property {string} account         account id (see Account)
 * @property {Market} market
 * @property {string} symbol
 * @property {Side} side
 * @property {number} qty             size in units of the asset (> 0)
 * @property {number} entry           average entry price
 * @property {string} entryAt         ISO 8601
 * @property {number|null} exit       average exit price; null while open
 * @property {string|null} exitAt
 * @property {number|null} leverage
 * @property {number} fees            paid (≥ 0)
 * @property {number} funding         received (+) or paid (−)
 * @property {number|null} pnl        net of fees and funding; null while open
 * @property {number|null} orderStop  the stop the order had on the exchange (proposed as the initial stop)
 * @property {number|null} stop       initial stop, set by the trader
 * @property {string|null} setup
 * @property {string|null} timeframe
 * @property {number|null} target     take profit
 * @property {number|null} emotion    1-5
 * @property {string[]} errors        discipline errors (none = a clean trade)
 * @property {string|null} notes
 */

/**
 * Balance of an exchange account at a moment, for net worth (in the doc's currency, open positions at market).
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} name
 * @property {number|null} balance
 * @property {number|null} rate      1 unit of the doc's currency in EUR
 * @property {string|null} at        ISO 8601 of the snapshot
 */

/**
 * Risk limits, in R (null = no limit): loss in a day, loss in a week, losing trades in a row.
 * @typedef {{ day: number|null, week: number|null, streak: number|null }} Limits
 */

/**
 * @typedef {Object} TradesDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of days and weeks
 * @property {string|null} domain  area whose page shows the trades
 * @property {string} currency
 * @property {Limits} limits
 * @property {string[]} setups      lists that grow as they are used
 * @property {string[]} timeframes
 * @property {string[]} errors
 * @property {Account[]} accounts
 * @property {Trade[]} trades       by entry time, latest first
 */

/** What the trader sets by hand. @typedef {Partial<Pick<Trade, 'stop'|'setup'|'timeframe'|'target'|'emotion'|'errors'|'notes'>>} HandFields */

/**
 * @typedef {{ type: 'add', trade: Trade }
 *   | { type: 'update', id: string, fields: Partial<Omit<Trade, 'id'>> }
 *   | { type: 'edit', id: string, fields: HandFields }
 *   | { type: 'delete', id: string }
 *   | { type: 'setLimits', limits: Partial<Limits> }
 *   | { type: 'setAccount', account: Account }
 *   | { type: 'removeAccount', id: string }
 *   | { type: 'setDomain', domain: string|null }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** @param {string} [timeZone] @returns {TradesDoc} */
export function emptyDoc(timeZone) {
  return {
    version: 1, ...(timeZone ? { timeZone } : {}), domain: null, currency: 'USD',
    limits: { day: null, week: null, streak: null }, setups: [], timeframes: [], errors: [], accounts: [], trades: [],
  };
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** @param {unknown} v @returns {number|null} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** @param {unknown} v @returns {number|null} */
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null; };
/** @param {unknown} v @returns {string|null} */
const isoOrNull = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
/** @param {unknown} v @returns {string[]} */
const texts = (v) => [...new Set((Array.isArray(v) ? v : []).map(textOrNull).filter((x) => x !== null))];

/** @param {any} x @returns {Trade|null} */
function normTrade(x) {
  if (!x || typeof x.id !== 'string' || !textOrNull(x.symbol) || !pos(x.qty) || !pos(x.entry) || !isoOrNull(x.entryAt)) return null;
  const exit = pos(x.exit);
  const emotion = Number.isInteger(x.emotion) && x.emotion >= 1 && x.emotion <= 5 ? x.emotion : null;
  return {
    id: x.id, extId: textOrNull(x.extId), account: textOrNull(x.account) ?? '', market: x.market in MARKET_TEXT ? x.market : 'spot',
    symbol: x.symbol.trim(), side: x.side === 'short' ? 'short' : 'long', qty: x.qty, entry: x.entry, entryAt: x.entryAt,
    exit, exitAt: exit === null ? null : isoOrNull(x.exitAt), leverage: pos(x.leverage), fees: Math.abs(num(x.fees) ?? 0),
    funding: num(x.funding) ?? 0, pnl: exit === null ? null : num(x.pnl), orderStop: pos(x.orderStop), stop: pos(x.stop),
    setup: textOrNull(x.setup), timeframe: textOrNull(x.timeframe), target: pos(x.target), emotion, errors: texts(x.errors),
    notes: textOrNull(x.notes),
  };
}

/** @param {Trade} a @param {Trade} b */
const byEntryDesc = (a, b) => b.entryAt.localeCompare(a.entryAt);

/**
 * Normalizes a document that was read (tolerates missing fields; drops trades without symbol, size, price or time).
 * @param {any} raw
 * @returns {TradesDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const l = doc.limits ?? {};
  /** @type {Set<string>} */
  const seen = new Set();
  const trades = (Array.isArray(doc.trades) ? doc.trades : []).map(normTrade)
    .filter((/** @type {Trade|null} */ t) => t && !seen.has(t.id) && !!seen.add(t.id));
  const accounts = (Array.isArray(doc.accounts) ? doc.accounts : [])
    .filter((/** @type {any} */ a) => a && typeof a.id === 'string')
    .map((/** @type {any} */ a) => ({ id: a.id, name: textOrNull(a.name) ?? a.id, balance: num(a.balance), rate: pos(a.rate), at: isoOrNull(a.at) }));
  return {
    ...doc, version: Number(doc.version) || 1, domain: textOrNull(doc.domain), currency: textOrNull(doc.currency) ?? 'USD',
    limits: { day: pos(l.day), week: pos(l.week), streak: Number.isInteger(l.streak) && l.streak > 0 ? l.streak : null },
    setups: texts(doc.setups), timeframes: texts(doc.timeframes), errors: texts(doc.errors), accounts,
    trades: /** @type {Trade[]} */ (trades).sort(byEntryDesc),
  };
}

/**
 * New trade with every field filled in.
 * @param {Pick<Trade, 'symbol'|'qty'|'entry'|'entryAt'> & Partial<Trade>} fields
 * @returns {Trade}
 */
export function newTrade(fields) {
  return {
    id: newId('tr_'), extId: null, account: '', market: 'spot', side: 'long', exit: null, exitAt: null, leverage: null,
    fees: 0, funding: 0, pnl: null, orderStop: null, stop: null, setup: null, timeframe: null, target: null, emotion: null,
    errors: [], notes: null, ...fields,
  };
}

// ---------------------------------------------------------------- figures of one trade

/** @param {Trade} t */
export const isClosed = (t) => t.exit !== null && t.pnl !== null;

/** What the trade loses if the initial stop is hit (null without a stop). @param {Trade} t */
export const risk = (t) => (t.stop === null ? null : Math.abs(t.entry - t.stop) * t.qty || null);

/** Result in R (null while open or without a stop). @param {Trade} t */
export function rOf(t) {
  const r = risk(t);
  return r && t.pnl !== null ? t.pnl / r : null;
}

/** Planned reward:risk of the target (null without stop or target). @param {Trade} t */
export function plannedRR(t) {
  if (t.stop === null || t.target === null) return null;
  const down = Math.abs(t.entry - t.stop);
  return down ? Math.abs(t.target - t.entry) / down : null;
}

// ---------------------------------------------------------------- risk limits

/**
 * Was a limit already hit when this trade was opened? Counts the trades closed before it (on its day, its week,
 * and the losing streak that ended that day).
 * @param {Trade[]} closed  closed trades
 * @param {Limits} limits @param {string} at ISO 8601 @param {string} tz
 * @returns {string[]} the limits hit: 'day', 'week', 'streak'
 */
export function limitsHitAt(closed, limits, at, tz) {
  const day = periodKey('day', at, tz);
  const week = periodKey('week', at, tz);
  const before = closed.filter((t) => /** @type {string} */ (t.exitAt ?? t.entryAt) <= at)
    .sort((a, b) => /** @type {string} */ (a.exitAt ?? a.entryAt).localeCompare(/** @type {string} */ (b.exitAt ?? b.entryAt)));
  /** @param {(t: Trade) => boolean} keep */
  const sumR = (keep) => before.filter(keep).reduce((s, t) => s + (rOf(t) ?? 0), 0);
  const closedOn = (/** @type {Trade} */ t, /** @type {'day'|'week'} */ h) => periodKey(h, /** @type {string} */ (t.exitAt ?? t.entryAt), tz);
  const hit = [];
  if (limits.day && sumR((t) => closedOn(t, 'day') === day) <= -limits.day) hit.push('day');
  if (limits.week && sumR((t) => closedOn(t, 'week') === week) <= -limits.week) hit.push('week');
  if (limits.streak) {
    let n = 0;
    for (let i = before.length - 1; i >= 0 && /** @type {number} */ (before[i].pnl) < 0; i--) n++;
    const last = before[before.length - 1];
    if (n >= limits.streak && last && closedOn(last, 'day') === day) hit.push('streak');
  }
  return hit;
}

/** The limits hit right now: banner "no more trading today". @param {TradesDoc} doc @param {Date|string} now @param {string} tz */
export const limitsHitNow = (doc, now, tz) => limitsHitAt(doc.trades.filter(isClosed), doc.limits, new Date(now).toISOString(), tz);

/** A trade's errors, with LIMIT_ERROR added if it was opened over a limit. @param {TradesDoc} doc @param {Trade} t @param {string} tz */
export function errorsOf(doc, t, tz) {
  const over = limitsHitAt(doc.trades.filter((x) => x.id !== t.id && isClosed(x)), doc.limits, t.entryAt, tz).length > 0;
  return over && !t.errors.includes(LIMIT_ERROR) ? [...t.errors, LIMIT_ERROR] : t.errors;
}

// ---------------------------------------------------------------- the panel

/** @typedef {'month'|'quarter'|'year'|'all'} Range */
export const RANGES = /** @type {const} */ (['month', 'quarter', 'year', 'all']);
/** @type {Record<Range, string>} */
export const RANGE_TEXT = { month: 'Month', quarter: '3 months', year: 'Year', all: 'All' };

/**
 * Closed trades in a range ending today (month = this calendar month; 3 months and year = the last 3 or 12).
 * @param {TradesDoc} doc @param {Range} range @param {Date|string} now @param {string} tz
 */
export function inRange(doc, range, now, tz) {
  const closed = doc.trades.filter(isClosed);
  if (range === 'all') return closed;
  const today = periodKey('day', now, tz);
  const [y, m] = today.split('-').map(Number);
  const back = range === 'month' ? 0 : range === 'quarter' ? 2 : 11;
  const first = new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 7);
  return closed.filter((t) => periodKey('day', /** @type {string} */ (t.exitAt ?? t.entryAt), tz).slice(0, 7) >= first);
}

/**
 * @typedef {Object} Stats
 * @property {number} n           closed trades
 * @property {number} withR       of them, with a stop (their R counts)
 * @property {number|null} winRate  0-1
 * @property {number|null} avgWin   average R of winners
 * @property {number|null} avgLoss  average R of losers (negative)
 * @property {number|null} expectancy  average R per trade
 * @property {number} totalR
 * @property {number} pnl
 * @property {number|null} profitFactor  gross profit / gross loss (null without losses)
 * @property {number} maxDrawdown  deepest fall of the R curve from a peak (≥ 0)
 * @property {number[]} curve      cumulative R after each trade, oldest first
 */

/** @param {number[]} xs */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** @param {Trade} a @param {Trade} b */
const byExit = (a, b) => /** @type {string} */ (a.exitAt ?? a.entryAt).localeCompare(/** @type {string} */ (b.exitAt ?? b.entryAt));

/** The panel's figures for closed trades. @param {Trade[]} list @returns {Stats} */
export function stats(list) {
  const closed = list.filter(isClosed).sort(byExit);
  const pnls = closed.map((t) => /** @type {number} */ (t.pnl));
  const rs = closed.map(rOf).filter((r) => r !== null);
  const gain = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const loss = -pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0);
  const curve = [];
  let sum = 0, peak = 0, maxDrawdown = 0;
  for (const r of rs) {
    sum += r;
    curve.push(sum);
    peak = Math.max(peak, sum);
    maxDrawdown = Math.max(maxDrawdown, peak - sum);
  }
  return {
    n: closed.length, withR: rs.length, winRate: closed.length ? pnls.filter((p) => p > 0).length / closed.length : null,
    avgWin: mean(rs.filter((r) => r > 0)), avgLoss: mean(rs.filter((r) => r <= 0)), expectancy: mean(rs), totalR: sum,
    pnl: pnls.reduce((a, b) => a + b, 0), profitFactor: loss ? gain / loss : null, maxDrawdown, curve,
  };
}

/** @typedef {'setup'|'market'|'side'|'timeframe'} Cut */
export const CUTS = /** @type {const} */ (['setup', 'market', 'side', 'timeframe']);
/** @type {Record<Cut, string>} */
export const CUT_TEXT = { setup: 'Setup', market: 'Market', side: 'Side', timeframe: 'Timeframe' };

/**
 * Stats per value of a field (trades without one go under "—"), most trades first.
 * @param {Trade[]} list @param {Cut} cut
 * @returns {{ key: string, stats: Stats }[]}
 */
export function breakdown(list, cut) {
  /** @type {Map<string, Trade[]>} */
  const groups = new Map();
  for (const t of list) {
    const key = cut === 'market' ? MARKET_TEXT[t.market] : cut === 'side' ? (t.side === 'long' ? 'Long' : 'Short') : t[cut] ?? '—';
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups].map(([key, ts]) => ({ key, stats: stats(ts) })).sort((a, b) => b.stats.n - a.stats.n || a.key.localeCompare(b.key));
}

/**
 * Discipline: clean trades against those with errors, and how often each error happened.
 * @param {TradesDoc} doc @param {Trade[]} list @param {string} tz
 */
export function discipline(doc, list, tz) {
  const withErrors = list.map((t) => ({ t, errors: errorsOf(doc, t, tz) }));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const { errors } of withErrors) for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1);
  return {
    clean: stats(withErrors.filter((x) => !x.errors.length).map((x) => x.t)),
    flawed: stats(withErrors.filter((x) => x.errors.length).map((x) => x.t)),
    errors: [...counts].map(([error, n]) => ({ error, n })).sort((a, b) => b.n - a.n || a.error.localeCompare(b.error)),
  };
}

/** Value of the trading accounts in EUR (accounts without a rate are left out). @param {TradesDoc} doc */
export const accountsInEur = (doc) => doc.accounts.reduce((s, a) => s + (a.balance !== null && a.rate ? a.balance * a.rate : 0), 0);

// ---------------------------------------------------------------- operations

/** The lists grow with what a trade uses. @param {TradesDoc} doc @param {Trade} t */
function learn(doc, t) {
  if (t.setup && !doc.setups.includes(t.setup)) doc.setups.push(t.setup);
  if (t.timeframe && !doc.timeframes.includes(t.timeframe)) doc.timeframes.push(t.timeframe);
  for (const e of t.errors) if (e !== LIMIT_ERROR && !doc.errors.includes(e)) doc.errors.push(e);
}

/**
 * Applies operations to a copy of the document. A trade whose exchange id is already there is not added twice;
 * operations on trades that no longer exist are ignored.
 * @param {TradesDoc} doc
 * @param {Op[]} ops
 * @returns {TradesDoc}
 */
export function applyOps(doc, ops) {
  /** @type {TradesDoc} */
  const out = structuredClone(doc);
  /** @param {string} id */
  const find = (id) => out.trades.find((x) => x.id === id);
  for (const op of ops) {
    switch (op.type) {
      case 'add': {
        const dup = find(op.trade.id) || (op.trade.extId && out.trades.some((x) => x.extId === op.trade.extId && x.account === op.trade.account));
        const t = normTrade(op.trade);
        if (!dup && t) { out.trades.push(t); learn(out, t); }
        break;
      }
      case 'update':
      case 'edit': {
        const t = find(op.id);
        const next = t && normTrade({ ...t, ...structuredClone(op.fields), id: t.id });
        if (t && next) { Object.assign(t, next); learn(out, t); }
        break;
      }
      case 'delete':
        out.trades = out.trades.filter((x) => x.id !== op.id);
        break;
      case 'setLimits':
        out.limits = normalize({ limits: { ...out.limits, ...op.limits } }).limits;
        break;
      case 'setAccount': {
        const a = normalize({ accounts: [op.account] }).accounts[0];
        if (a) out.accounts = [...out.accounts.filter((x) => x.id !== a.id), a];
        break;
      }
      case 'removeAccount':
        out.accounts = out.accounts.filter((x) => x.id !== op.id);
        break;
      case 'setDomain':
        out.domain = op.domain;
        break;
      case 'setTimeZone':
        if (isValidTimeZone(op.timeZone)) out.timeZone = op.timeZone;
        break;
    }
  }
  out.trades.sort(byEntryDesc);
  return out;
}

/**
 * Commit message for a batch of operations: what changed, counted (no symbols or figures: they are not encrypted).
 * @param {Op[]} ops
 */
export function commitMessage(ops) {
  /** @type {Record<string, number>} */
  const n = {};
  for (const op of ops) n[op.type] = (n[op.type] ?? 0) + 1;
  /** @type {[string, string][]} */
  const words = [['add', 'new'], ['update', 'updated'], ['edit', 'edited'], ['delete', 'deleted']];
  const parts = words.filter(([k]) => n[k]).map(([k, w]) => `${n[k]} ${w}`);
  if (n.setLimits) parts.push('limits');
  if (n.setAccount || n.removeAccount) parts.push('accounts');
  if (n.setDomain) parts.push('area');
  if (n.setTimeZone) parts.push('time zone');
  return `trades: ${parts.join(', ') || 'update'}`;
}
