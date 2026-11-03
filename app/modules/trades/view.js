// @ts-check
// Trades module (app side): on its area's page, the "limit hit" banner, the panel (figures, R curve and cuts by
// setup, market, side, timeframe and discipline) for a range, and the trades; a trade's sheet with what the
// exchange knows (read only) and what the trader adds (stop, setup, timeframe, target, emotion, errors, notes);
// the limits sheet; the area's card on Home and the banner on top of Home. Trades are not typed in: they come from
// the exchanges (and the CLI). Everything here is sealed with the encryption password (lib/trades.js).
import * as tradesLib from '../../../lib/trades.js';
import { canEdit, dispatchTrades, inAreas, passphrase, render, tradesStore, tz } from '../../core/data.js';
import { chipPicker, h, lsGet, lsSet, openSheet, sparkline } from '../../core/ui.js';

/** @typedef {import('../../../lib/trades.js').Trade} Trade */
/** @typedef {import('../../../lib/trades.js').TradesDoc} TradesDoc */

const UI_KEY = 'compass.tradesUi';
/** Range and cut chosen on the panel (per device). @type {{ range: tradesLib.Range, cut: tradesLib.Cut|'discipline' }} */
const ui = { range: 'month', cut: 'setup', ...(lsGet(UI_KEY) ?? {}) };
/** How many closed trades the list shows before "Show all". */
const LIST_MAX = 15;
let showAll = false;

const doc = () => tradesStore.current();

/** Does this area show the trades? (Its file names the area; locked without the password.) @param {Set<string>} ids */
export const hasTrades = (ids) => !!passphrase() && tradesStore.state.loaded && !!doc().domain && inAreas(ids, /** @type {string} */ (doc().domain));

/** @param {number|null} r */
export const rText = (r) => (r === null ? '—' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)} R`);
/** @param {number} n @param {string} [currency] */
// The same minus sign as the R figures (−$14.91, −1.09 R).
export const money = (n, currency = doc().currency) => n.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).replace('-', '−');
/** @param {number|null} x */
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
/** @param {number|null} n */
const tone = (n) => (n === null || n === 0 ? '' : n > 0 ? 'up' : 'down');
/** @param {string} iso */
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz() });

/** "Limit hit" line, or null. @param {string[]} hit */
function limitText(hit) {
  if (!hit.length) return null;
  /** @type {Record<string, string>} */
  const why = { day: 'daily loss', week: 'weekly loss', streak: 'losses in a row' };
  return `Limit hit (${hit.map((x) => why[x]).join(', ')}): no more trading today.`;
}

/** The banner on top of Home and of the Trades block when a limit is hit now. */
export function limitBanner() {
  if (!passphrase() || !tradesStore.state.loaded) return null;
  const text = limitText(tradesLib.limitsHitNow(doc(), new Date(), tz()));
  return text ? h('div', { class: 'banner', 'data-kind': 'error', role: 'status' }, text) : null;
}

// ---------------------------------------------------------------- the panel

/** @param {string} label @param {string} value @param {string} [cls] */
const figure = (label, value, cls = '') => h('div', { class: `figure ${cls}` }, h('b', {}, value), h('span', {}, label));

/** @param {tradesLib.Stats} s */
function figures(s) {
  return h('div', { class: 'figures' },
    figure('trades', String(s.n)),
    figure('win rate', pct(s.winRate)),
    figure('expectancy', rText(s.expectancy), tone(s.expectancy)),
    figure('total', rText(s.withR ? s.totalR : null), tone(s.totalR)),
    figure('net PnL', money(s.pnl), tone(s.pnl)),
    figure('profit factor', s.profitFactor === null ? '—' : s.profitFactor.toFixed(2)),
    figure('avg win', rText(s.avgWin)),
    figure('avg loss', rText(s.avgLoss)),
    figure('max drawdown', s.withR ? `${s.maxDrawdown.toFixed(2)} R` : '—'));
}

/** A cut as a table: one row per value. @param {{ key: string, stats: tradesLib.Stats }[]} rows */
function cutTable(rows) {
  if (!rows.length) return h('p', { class: 'hint' }, 'No closed trades in this range.');
  return h('table', { class: 'cut' },
    h('thead', {}, h('tr', {}, ...['', 'Trades', 'Win', 'Exp.', 'Total', 'PnL'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...rows.map(({ key, stats: s }) => h('tr', {},
      h('th', {}, key), h('td', {}, String(s.n)), h('td', {}, pct(s.winRate)),
      h('td', { class: tone(s.expectancy) }, rText(s.expectancy)), h('td', { class: tone(s.totalR) }, rText(s.withR ? s.totalR : null)),
      h('td', { class: tone(s.pnl) }, money(s.pnl))))));
}

function panel() {
  const d = doc();
  const list = tradesLib.inRange(d, ui.range, new Date(), tz());
  const s = tradesLib.stats(list);
  const save = () => { lsSet(UI_KEY, ui); render(); };
  const ranges = h('div', { class: 'chip-pick', role: 'radiogroup', 'aria-label': 'Range' });
  chipPicker(ranges, tradesLib.RANGES.map((r) => /** @type {[string, string]} */ ([r, tradesLib.RANGE_TEXT[r]])), ui.range, (v) => { ui.range = /** @type {tradesLib.Range} */ (v); save(); });
  const cuts = h('div', { class: 'chip-pick', role: 'radiogroup', 'aria-label': 'Cut' });
  chipPicker(cuts, [...tradesLib.CUTS.map((c) => /** @type {[string, string]} */ ([c, tradesLib.CUT_TEXT[c]])), ['discipline', 'Discipline']], ui.cut, (v) => { ui.cut = /** @type {any} */ (v); save(); });
  /** @type {HTMLElement[]} */
  let cut;
  if (ui.cut === 'discipline') {
    const dis = tradesLib.discipline(d, list, tz());
    cut = [cutTable([{ key: 'Clean', stats: dis.clean }, { key: 'With errors', stats: dis.flawed }].filter((x) => x.stats.n)),
      ...(dis.errors.length ? [h('ul', { class: 'mini-list error-counts' }, ...dis.errors.map((e) => h('li', { class: 'mini' }, h('span', { class: 'mini-title' }, e.error), h('span', { class: 'chip danger' }, `${e.n}×`))))] : [])];
  } else cut = [cutTable(tradesLib.breakdown(list, ui.cut))];
  return h('div', { class: 'panel' },
    ranges,
    figures(s),
    s.withR > 1 ? h('figure', { class: 'curve' }, sparkline(s.curve, { label: `R curve: ${rText(s.totalR)} after ${s.withR} trades` }), h('figcaption', { class: 'hint' }, `R curve · ${s.withR} trades`)) : null,
    s.withR < s.n ? h('p', { class: 'hint' }, `${s.n - s.withR} without a stop: they count in PnL, not in R.`) : null,
    h('h3', { class: 'panel-head' }, 'By'), cuts, ...cut);
}

// ---------------------------------------------------------------- the trades

/** A trade's row: symbol, side and date; R (or open); chips for what is missing or went wrong. @param {Trade} t */
function tradeRow(t) {
  const d = doc();
  const r = tradesLib.rOf(t);
  const errors = tradesLib.errorsOf(d, t, tz());
  return h('li', { class: 'task trade-row' },
    h('button', { class: 'task-title trade-open', onclick: () => openTrade(t.id) },
      h('span', { class: 'trade-sym' }, t.symbol),
      h('span', { class: 'hint' }, ` ${t.side === 'long' ? 'Long' : 'Short'} · ${when(t.entryAt)}`)),
    h('span', { class: 'task-meta' },
      t.stop === null ? h('span', { class: 'chip warn' }, 'no stop') : null,
      t.setup ? h('span', { class: 'chip muted' }, t.setup) : null,
      errors.length ? h('span', { class: 'chip danger', title: errors.join(', ') }, `${errors.length} error${errors.length > 1 ? 's' : ''}`) : null,
      tradesLib.isClosed(t) ? h('span', { class: `r ${tone(r ?? t.pnl)}` }, r === null ? money(/** @type {number} */ (t.pnl)) : rText(r)) : h('span', { class: 'chip' }, 'open')));
}

/** The area's block: banner, panel, open trades, closed trades. @param {import('../index.js').AreaScope} _scope */
export function areaSections(_scope) {
  const d = doc();
  const open = d.trades.filter((t) => !tradesLib.isClosed(t));
  const closed = d.trades.filter(tradesLib.isClosed);
  const shown = showAll ? closed : closed.slice(0, LIST_MAX);
  const limits = d.limits;
  const limitsLine = [limits.day && `${limits.day} R a day`, limits.week && `${limits.week} R a week`, limits.streak && `${limits.streak} losses in a row`].filter(Boolean).join(' · ');
  return [
    limitBanner(),
    h('p', { class: 'hint limits-line' }, limitsLine ? `Limits: ${limitsLine}. ` : 'No risk limits. ', h('button', { class: 'link', disabled: !canEdit(), onclick: openLimits }, 'Change')),
    panel(),
    open.length ? h('section', { class: 'group sub-group' }, h('h3', {}, 'Open', h('span', { class: 'sub' }, String(open.length))), h('ul', { class: 'rows' }, ...open.map(tradeRow))) : null,
    h('section', { class: 'group sub-group' }, h('h3', {}, 'Closed', h('span', { class: 'sub' }, String(closed.length))),
      closed.length ? h('ul', { class: 'rows' }, ...shown.map(tradeRow)) : h('p', { class: 'empty small' }, 'No trades yet: they come from the exchanges.'),
      closed.length > shown.length ? h('button', { class: 'link', onclick: () => { showAll = true; render(); } }, `Show all ${closed.length}`) : null),
  ].filter((x) => x !== null);
}

/** The area's card on Home: trades and R this month. @param {import('../index.js').AreaScope} scope */
export function homeCard(scope) {
  if (!hasTrades(scope.ids)) return { stats: [], body: [] };
  const s = tradesLib.stats(tradesLib.inRange(doc(), 'month', new Date(), tz()));
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['trades this month', s.n], ['this month', rText(s.withR ? s.totalR : null), s.totalR < 0 ? 'danger' : undefined]];
  // A limit hit shows on top of Home (limitBanner), not again here.
  return { stats, body: [] };
}

// ---------------------------------------------------------------- a trade's sheet

/** @param {string} label @param {string|number|null} value */
const fact = (label, value) => (value === null || value === '' ? null : h('div', { class: 'fact' }, h('span', { class: 'hint' }, label), h('b', {}, String(value))));

/** A number field saved when it changes (empty = none). @param {string} label @param {number|null} value @param {(v: number|null) => void} save @param {string} [placeholder] */
function numberField(label, value, save, placeholder = '') {
  const input = h('input', { type: 'text', inputmode: 'decimal', value: value ?? '', placeholder, disabled: !canEdit(), autocomplete: 'off' });
  input.addEventListener('change', () => {
    const raw = input.value.trim().replace(',', '.');
    const n = Number(raw);
    if (raw && !(Number.isFinite(n) && n > 0)) { input.value = value === null ? '' : String(value); return; }
    save(raw ? n : null);
  });
  return h('label', {}, label, input);
}

/**
 * Chips to pick one (or, with `many`, several) from a list that grows, plus a field to add a new one.
 * @param {string} legend @param {string[]} options @param {string[]} chosen @param {(v: string[]) => void} save @param {{ many?: boolean, placeholder: string }} opts
 */
function growingChips(legend, options, chosen, save, opts) {
  const edit = canEdit();
  const all = [...new Set([...options, ...chosen])];
  const box = h('div', { class: 'chip-pick' }, ...all.map((o) => h('button', {
    type: 'button', class: 'chip-opt', role: opts.many ? 'checkbox' : 'radio', 'aria-checked': String(chosen.includes(o)), disabled: !edit,
    onclick: () => save(chosen.includes(o) ? chosen.filter((x) => x !== o) : opts.many ? [...chosen, o] : [o]),
  }, o)));
  const add = h('input', { placeholder: opts.placeholder, maxlength: 40, autocomplete: 'off', disabled: !edit, 'aria-label': opts.placeholder });
  add.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    const v = add.value.trim();
    if (v) save(opts.many ? [...new Set([...chosen, v])] : [v]);
  });
  add.addEventListener('change', () => { const v = add.value.trim(); if (v) save(opts.many ? [...new Set([...chosen, v])] : [v]); });
  return h('fieldset', { class: 'pick' }, h('legend', {}, legend), box, add);
}

/** A trade's sheet: the exchange's facts, the figures, and the fields to fill in (each saved as it changes). @param {string} id */
export function openTrade(id) {
  openSheet((body, redraw, close) => {
    const d = doc();
    const t = d.trades.find((x) => x.id === id);
    if (!t) return close();
    /** @param {tradesLib.HandFields} fields */
    const save = (fields) => { dispatchTrades({ type: 'edit', id: t.id, fields }); redraw(); };
    const closed = tradesLib.isClosed(t);
    const r = tradesLib.rOf(t);
    const rr = tradesLib.plannedRR(t);
    const auto = tradesLib.errorsOf(d, t, tz()).includes(tradesLib.LIMIT_ERROR) && !t.errors.includes(tradesLib.LIMIT_ERROR);
    const emotion = h('div', { class: 'chip-pick', role: 'radiogroup', 'aria-label': 'Emotion' });
    chipPicker(emotion, [1, 2, 3, 4, 5].map((n) => /** @type {[string, string]} */ ([String(n), String(n)])), String(t.emotion ?? ''), (v) => save({ emotion: t.emotion === Number(v) ? null : Number(v) }));
    for (const b of emotion.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = !canEdit();
    const notes = h('textarea', { rows: 3, maxlength: 5000, placeholder: 'What you saw, what you would do again…', disabled: !canEdit() });
    notes.value = t.notes ?? '';
    notes.addEventListener('change', () => save({ notes: notes.value.trim() || null }));

    // append() would write a missing piece (null) as text.
    body.append(...[
      h('div', { class: 'sheet-head' }, h('h2', {}, `${t.symbol} · ${t.side === 'long' ? 'Long' : 'Short'}`), h('span', { class: `r big ${tone(r ?? t.pnl)}` }, closed ? (r === null ? money(/** @type {number} */ (t.pnl)) : rText(r)) : 'Open')),
      h('div', { class: 'facts' },
        fact('Market', tradesLib.MARKET_TEXT[t.market]), fact('Account', t.account), fact('Size', t.qty),
        fact('Entry', `${t.entry} · ${when(t.entryAt)}`), fact('Exit', t.exit === null ? null : `${t.exit} · ${when(/** @type {string} */ (t.exitAt))}`),
        fact('Leverage', t.leverage === null ? null : `${t.leverage}×`), fact('Fees', t.fees ? money(t.fees) : null),
        fact('Funding', t.funding ? money(t.funding) : null), fact('Net PnL', t.pnl === null ? null : money(t.pnl)),
        fact('Risk (1 R)', tradesLib.risk(t) === null ? null : money(/** @type {number} */ (tradesLib.risk(t)))),
        fact('R:R planned → got', rr === null ? null : `${rr.toFixed(2)} → ${r === null ? '…' : r.toFixed(2).replace('-', '−')}`)),
      h('div', { class: 'two' },
        numberField('Initial stop', t.stop, (v) => save({ stop: v }), t.orderStop === null ? 'Price' : `Order's: ${t.orderStop}`),
        numberField('Target', t.target, (v) => save({ target: v }), 'Take profit')),
      t.stop === null && t.orderStop !== null ? h('button', { type: 'button', class: 'link', disabled: !canEdit(), onclick: () => save({ stop: t.orderStop }) }, `Use the order's stop (${t.orderStop})`) : null,
      growingChips('Setup', d.setups, t.setup ? [t.setup] : [], (v) => save({ setup: v[0] ?? null }), { placeholder: 'New setup' }),
      growingChips('Timeframe', d.timeframes, t.timeframe ? [t.timeframe] : [], (v) => save({ timeframe: v[0] ?? null }), { placeholder: 'New timeframe (4h, 1d…)' }),
      h('fieldset', { class: 'pick' }, h('legend', {}, 'Emotion (1 calm – 5 stressed)'), emotion),
      growingChips('Discipline errors (none = a clean trade)', d.errors, t.errors, (v) => save({ errors: v }), { many: true, placeholder: 'New error' }),
      auto ? h('p', { class: 'chip danger' }, `${tradesLib.LIMIT_ERROR}: opened after a limit was hit`) : null,
      h('label', {}, 'Notes', notes),
      h('div', { class: 'actions' }, h('div', { class: 'extra' }), h('button', { type: 'button', class: 'btn primary', onclick: close }, 'Done')),
    ].filter((x) => x !== null));
  }, { onClose: render });
}

// ---------------------------------------------------------------- limits

/** The risk limits, in R (empty = none). */
function openLimits() {
  openSheet((body, _redraw, close) => {
    const l = doc().limits;
    const field = (/** @type {string} */ label, /** @type {number|null} */ v, /** @type {string} */ hint) => h('label', {}, label,
      h('input', { type: 'text', inputmode: 'decimal', value: v ?? '', placeholder: hint, autocomplete: 'off' }));
    const day = field('Loss in a day (R)', l.day, 'e.g. 2');
    const week = field('Loss in a week (R)', l.week, 'e.g. 5');
    const streak = field('Losing trades in a row', l.streak, 'e.g. 3');
    const msg = h('p', { class: 'msg', role: 'status' });
    const read = (/** @type {HTMLElement} */ lab, /** @type {boolean} */ whole) => {
      const raw = /** @type {HTMLInputElement} */ (lab.querySelector('input')).value.trim().replace(',', '.');
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 && (!whole || Number.isInteger(n)) ? n : NaN;
    };
    body.append(
      h('h2', {}, 'Risk limits'),
      h('p', { class: 'hint' }, 'When one is hit, Home and Trades say “no more trading today”, and trades opened after it count as a discipline error.'),
      day, week, streak, msg,
      h('div', { class: 'actions' }, h('div', { class: 'extra' }),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => {
          const limits = { day: read(day, false), week: read(week, false), streak: read(streak, true) };
          if (Object.values(limits).some((v) => Number.isNaN(v))) { msg.textContent = 'Use numbers greater than 0 (whole for the streak), or leave empty.'; return; }
          dispatchTrades({ type: 'setLimits', limits });
          close();
        } }, 'Save')),
    );
  }, { onClose: render });
}
