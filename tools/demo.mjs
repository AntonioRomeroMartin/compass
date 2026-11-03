#!/usr/bin/env node
// @ts-check
// Sample data for a local preview (made-up, the same every time): writes the data files to DIR, trades sealed with
// the password "demo". Then: python3 tools/serve.py 8767 --demo DIR, and open http://127.0.0.1:8767/?demo
//
// Usage: node tools/demo.mjs DIR

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as trades from '../lib/trades.js';
import * as tasks from '../lib/tasks.js';
import { sealSync } from '../cli/crypt.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/demo.mjs DIR');
  process.exit(1);
}
const TZ = 'Europe/Lisbon';
const PASS = 'demo';
const now = new Date();
const day = (/** @type {number} */ back) => new Date(now.getTime() - back * 86400000);
const date = (/** @type {number} */ back) => day(back).toISOString().slice(0, 10);

// The same "random" numbers every time.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** @template T @param {T[]} xs */
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

/** @param {string} name @param {unknown} doc */
const write = (name, doc) => writeFileSync(join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2) + '\n');

mkdirSync(dir, { recursive: true });
write('goals.json', { version: 1, timeZone: TZ, categories: [], goals: [
  { id: 'g_read', kind: 'goal', title: 'Read 3 papers', category: 'work', horizon: 'month', target: 3, unit: null, deadline: null, progress: 1, createdAt: day(3).toISOString() },
] });
write('domains.json', { version: 1, domains: [
  { id: 'work', name: 'Work', paths: [] },
  { id: 'money', name: 'Money', paths: [] },
  { id: 'money/trading', name: 'Trading', parent: 'money', paths: [] },
] });
write('tasks.json', tasks.serialize(tasks.applyOps(tasks.emptyDoc(TZ), [
  { type: 'add', task: tasks.newTask({ title: 'Read the exchange fee schedule', domain: 'money', due: date(-2) }) },
  { type: 'add', task: tasks.newTask({ title: 'Write the weekly report', domain: 'work', due: date(0) }) },
])));

// ---- trades: about 45 over the last 6 months, two open, the last two today (losses: the day limit is hit)
const SETUPS = ['Breakout', 'Pullback', 'Range fade'];
const ERRORS = ['Moved the stop', 'No setup', 'Too big', 'Exited early'];
/** @type {trades.Op[]} */
const tops = [
  { type: 'setDomain', domain: 'money/trading' },
  { type: 'setLimits', limits: { day: 2, week: 5, streak: 3 } },
];
for (let i = 0; i < 46; i++) {
  const back = i < 2 ? 0 : i < 4 ? 1 : Math.floor(2 + rand() * 178);
  const market = /** @type {trades.Market} */ (pick(['spot', 'perp', 'perp', 'stock']));
  const symbol = market === 'stock' ? pick(['AAA', 'BBB', 'ETF1']) : pick(['COINAUSDT', 'COINBUSDT', 'COINCUSDT']);
  const side = /** @type {trades.Side} */ (market === 'spot' ? 'long' : pick(['long', 'long', 'short']));
  const entry = Math.round((20 + rand() * 180) * 100) / 100;
  const stopDist = entry * (0.01 + rand() * 0.03);
  const qty = Math.round((25 / stopDist) * 1000) / 1000;
  const stop = Math.round((side === 'long' ? entry - stopDist : entry + stopDist) * 100) / 100;
  const r = i < 2 ? -1.05 : rand() < 0.45 ? 0.6 + rand() * 2.6 : -(0.4 + rand() * 0.7);
  const open = i === 2 || i === 3;
  const exit = Math.round((side === 'long' ? entry + r * stopDist : entry - r * stopDist) * 100) / 100;
  const fees = Math.round(qty * entry * 0.0008 * 100) / 100;
  // The last two, in the two hours before now; the others at some hour of their day.
  const entryAt = i < 2 ? new Date(now.getTime() - (4 - 2 * i) * 3600000) : new Date(day(back).setUTCHours(9 + Math.floor(rand() * 8), 15, 0, 0));
  tops.push({ type: 'add', trade: trades.newTrade({
    extId: `demo-${i}`, account: market === 'stock' ? 'broker' : 'exchange', market, symbol, side, qty, entry,
    entryAt: entryAt.toISOString(), leverage: market === 'perp' ? pick([2, 3, 5]) : null, fees, funding: market === 'perp' ? -Math.round(rand() * 50) / 100 : 0,
    orderStop: rand() < 0.8 ? stop : null,
    ...(open ? {} : { exit, exitAt: new Date(Math.min(now.getTime() - 60000, entryAt.getTime() + (i < 2 ? 1 : 1 + rand() * 60) * 3600000)).toISOString(), pnl: Math.round((r * qty * stopDist - fees) * 100) / 100 }),
    // The hand fields: most trades have them, a few are still to fill in.
    ...(rand() < 0.85 || i < 2 ? {
      stop, setup: pick(SETUPS), timeframe: pick(['1h', '4h', '1d']), target: Math.round((side === 'long' ? entry + 2 * stopDist : entry - 2 * stopDist) * 100) / 100,
      emotion: 1 + Math.floor(rand() * 5), errors: rand() < 0.25 ? [pick(ERRORS)] : [],
    } : {}),
  }) });
}
write('trades.json', sealSync(trades.serialize(trades.applyOps(trades.emptyDoc(TZ), tops)), PASS));

console.log(`Sample data in ${dir} (password "demo"). Next: python3 tools/serve.py 8767 --demo ${dir}  →  http://127.0.0.1:8767/?demo`);
