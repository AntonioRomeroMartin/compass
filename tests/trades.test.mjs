// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as trades from '../lib/trades.js';

/** A closed long trade: entry 100, stop 90 (1 R = 10 × qty), result in R. @param {string} at @param {number} r @param {Partial<trades.Trade>} [more] */
const closed = (at, r, more = {}) => trades.newTrade({
  symbol: 'ABC', qty: 1, entry: 100, entryAt: at, stop: 90, exit: 100 + 10 * r, exitAt: at.replace('T09', 'T10'), pnl: 10 * r, ...more,
});

test('R, risk and planned reward:risk of a trade', () => {
  const t = trades.newTrade({ symbol: 'ABC', side: 'short', qty: 2, entry: 50, entryAt: '2026-03-02T09:00:00Z', stop: 55, target: 35, exit: 40, exitAt: '2026-03-03T09:00:00Z', pnl: 19 });
  assert.equal(trades.risk(t), 10);
  assert.equal(trades.rOf(t), 1.9);
  assert.equal(trades.plannedRR(t), 3);
  assert.equal(trades.rOf({ ...t, stop: null }), null);
  assert.equal(trades.isClosed({ ...t, exit: null, pnl: null }), false);
});

test('panel: win rate, average R, expectancy, profit factor, drawdown and curve', () => {
  const list = [closed('2026-03-02T09:00:00Z', 2), closed('2026-03-03T09:00:00Z', -1), closed('2026-03-04T09:00:00Z', -1), closed('2026-03-05T09:00:00Z', 3)];
  const s = trades.stats(list);
  assert.equal(s.n, 4);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.avgWin, 2.5);
  assert.equal(s.avgLoss, -1);
  assert.equal(s.expectancy, 0.75);
  assert.equal(s.totalR, 3);
  assert.equal(s.pnl, 30);
  assert.equal(s.profitFactor, 2.5);
  assert.equal(s.maxDrawdown, 2);
  assert.deepEqual(s.curve, [2, 1, 0, 3]);
  const bySetup = trades.breakdown([{ ...list[0], setup: 'Breakout' }, { ...list[1], setup: 'Breakout' }, list[2]], 'setup');
  assert.deepEqual(bySetup.map((b) => [b.key, b.stats.n, b.stats.totalR]), [['Breakout', 2, 1], ['—', 1, -1]]);
  assert.deepEqual(trades.breakdown(list, 'side').map((b) => b.key), ['Long']);
});

test('ranges: this month, the last 3 and 12 months, all', () => {
  let doc = trades.emptyDoc('UTC');
  doc = trades.applyOps(doc, [closed('2026-03-02T09:00:00Z', 1), closed('2026-01-10T09:00:00Z', 1), closed('2025-06-10T09:00:00Z', 1)].map((trade) => ({ type: 'add', trade })));
  const now = '2026-03-20T12:00:00Z';
  assert.deepEqual(trades.RANGES.map((r) => trades.inRange(doc, r, now, 'UTC').length), [1, 2, 3, 3]);
  assert.equal(trades.inRange(doc, 'year', now, 'UTC').length, 3);
  assert.equal(trades.inRange(doc, 'year', '2026-07-01T00:00:00Z', 'UTC').length, 2);
});

test('limits: a day, a week and losing streaks; later trades get the limit error', () => {
  let doc = trades.emptyDoc('UTC');
  doc = trades.applyOps(doc, [{ type: 'setLimits', limits: { day: 2, week: 4, streak: 3 } }]);
  const a = closed('2026-03-02T09:00:00Z', -1);
  const b = closed('2026-03-02T11:00:00Z', -1);
  const c = trades.newTrade({ symbol: 'XYZ', qty: 1, entry: 10, entryAt: '2026-03-02T15:00:00Z' });
  doc = trades.applyOps(doc, [a, b, c].map((trade) => ({ type: 'add', trade })));
  assert.deepEqual(trades.limitsHitNow(doc, '2026-03-02T16:00:00Z', 'UTC'), ['day']);
  assert.deepEqual(trades.limitsHitNow(doc, '2026-03-03T08:00:00Z', 'UTC'), []);
  assert.deepEqual(trades.errorsOf(doc, doc.trades.find((t) => t.id === c.id), 'UTC'), [trades.LIMIT_ERROR]);
  assert.deepEqual(trades.errorsOf(doc, doc.trades.find((t) => t.id === a.id), 'UTC'), []);
  // Two more losses on Tuesday: the week reaches 4 R, and three in a row that day is a streak.
  doc = trades.applyOps(doc, [closed('2026-03-03T09:00:00Z', -1), closed('2026-03-03T11:00:00Z', -1)].map((trade) => ({ type: 'add', trade })));
  assert.deepEqual(trades.limitsHitNow(doc, '2026-03-03T12:00:00Z', 'UTC'), ['day', 'week', 'streak']);
  assert.deepEqual(trades.limitsHitNow(doc, '2026-03-04T12:00:00Z', 'UTC'), ['week']);
  assert.deepEqual(trades.limitsHitNow(doc, '2026-03-09T12:00:00Z', 'UTC'), []);
  const d = trades.discipline(doc, doc.trades.filter(trades.isClosed), 'UTC');
  // Tuesday's second loss came after three in a row (Monday's two and Tuesday's first): over the streak limit.
  assert.equal(d.clean.n, 3);
  assert.deepEqual(d.errors, [{ error: trades.LIMIT_ERROR, n: 1 }]);
});

test('operations: no duplicate imports, hand fields, lists that grow, counted commit messages', () => {
  const t = trades.newTrade({ symbol: 'ABC', qty: 1, entry: 100, entryAt: '2026-03-02T09:00:00Z', extId: 'x1', account: 'ex', orderStop: 95 });
  let doc = trades.applyOps(trades.emptyDoc('UTC'), [{ type: 'add', trade: t }, { type: 'add', trade: { ...t, id: 'other' } }]);
  assert.equal(doc.trades.length, 1);
  doc = trades.applyOps(doc, [{ type: 'edit', id: t.id, fields: { stop: 95, setup: 'Pullback', timeframe: '4h', errors: ['Moved the stop'], emotion: 4 } }]);
  assert.deepEqual([doc.setups, doc.timeframes, doc.errors], [['Pullback'], ['4h'], ['Moved the stop']]);
  doc = trades.applyOps(doc, [{ type: 'update', id: t.id, fields: { exit: 110, exitAt: '2026-03-03T09:00:00Z', pnl: 9.5 } }]);
  assert.equal(trades.rOf(doc.trades[0]), 1.9);
  assert.equal(trades.normalize(JSON.parse(trades.serialize(doc))).trades[0].stop, 95);
  assert.equal(trades.commitMessage([{ type: 'add', trade: t }, { type: 'add', trade: t }, { type: 'edit', id: t.id, fields: {} }]), 'trades: 2 new, 1 edited');
});
