// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as finance from '../lib/finance.js';

/** @param {string} date @param {number} amount @param {string} text @param {Partial<finance.Movement>} [more] */
const mv = (date, amount, text, more = {}) => ({ id: finance.newId('m_'), extId: null, account: 'bank', date, amount, text, category: null, ...more });

/** A budget with two categories, a rule and movements over three months. */
function sample() {
  return finance.applyOps(finance.emptyDoc('UTC'), [
    { type: 'addCategory', category: { id: 'food', name: 'Food', limits: [{ from: '2026-01', amount: 300 }] } },
    { type: 'addCategory', category: { id: 'fun', name: 'Fun', limits: [] } },
    { type: 'setLimit', id: 'fun', from: '2026-03', amount: 100 },
    { type: 'addRule', rule: { id: 'r1', match: 'market', category: 'food' } },
    { type: 'addRule', rule: { id: 'r2', match: 'to savings', category: finance.TRANSFER } },
    ...[
      mv('2026-01-05', -200, 'Super MARKET'), mv('2026-02-05', -100, 'Market'), mv('2026-02-06', -40, 'Cinema', { category: 'fun' }),
      mv('2026-03-01', 1500, 'Salary'), mv('2026-03-02', -120, 'Market'), mv('2026-03-03', -50, 'Cinema', { category: 'fun' }),
      mv('2026-03-04', -500, 'Move to savings'), mv('2026-03-05', -30, 'Bookshop'),
    ].map((movement) => ({ type: /** @type {const} */ ('addMovement'), movement })),
  ]);
}

test('budget: spent against limit, transfers left out, uncategorized, averages of earlier months', () => {
  const b = finance.budget(sample(), '2026-03');
  assert.deepEqual(b.categories.map((c) => [c.id, c.spent, c.limit, c.avg]), [['food', 120, 300, 150], ['fun', 50, 100, 20]]);
  assert.equal(b.income, 1500);
  assert.equal(b.expenses, 200);
  assert.equal(b.saved, 1300);
  assert.equal(b.avgExpenses, 170);
  assert.deepEqual(b.uncategorized.map((m) => m.text), ['Bookshop']);
  assert.equal(finance.budget(sample(), '2026-02').categories[1].limit, null);
  // A new rule applies to what was there already.
  const doc = finance.applyOps(sample(), [{ type: 'addRule', rule: { id: 'r3', match: 'book', category: 'fun' } }]);
  assert.equal(finance.budget(doc, '2026-03').uncategorized.length, 0);
});

test('movements: imports are not duplicated (bank id, or day + amount + text)', () => {
  let doc = sample();
  const n = doc.movements.length;
  doc = finance.applyOps(doc, [
    { type: 'addMovement', movement: mv('2026-03-02', -120, 'Market') },
    { type: 'addMovement', movement: mv('2026-03-06', -5, 'Coffee', { extId: 'b1' }) },
    { type: 'addMovement', movement: mv('2026-03-07', -9, 'Coffee 2', { extId: 'b1' }) },
  ]);
  assert.equal(doc.movements.length, n + 1);
  assert.equal(finance.commitMessage([{ type: 'addMovement', movement: mv('2026-03-02', -1, 'x') }, { type: 'categorize', id: 'x', category: 'food' }]), 'finance: 1 movement, 1 categorized');
});

test('net worth by kind (debts subtract, other currencies by rate) and savings goals', () => {
  const doc = finance.applyOps(finance.emptyDoc(), [
    { type: 'setAccount', account: { id: 'a', name: 'Bank', kind: 'bank', currency: 'EUR', balance: 2000, rate: null, at: null, address: null } },
    { type: 'setAccount', account: { id: 'b', name: 'Wallet', kind: 'defi', currency: 'USD', balance: 100, rate: 0.9, at: null, address: '0xabc' } },
    { type: 'setAccount', account: { id: 'c', name: 'Loan', kind: 'debt', currency: 'EUR', balance: 500, rate: null, at: null, address: null } },
    { type: 'setSaving', saving: { goal: 'g1', kind: 'networth', target: 5000, base: null } },
    { type: 'setSaving', saving: { goal: 'g2', kind: 'saved', target: 1000, base: 1200 } },
  ]);
  const w = finance.netWorth(doc);
  assert.deepEqual(w.byKind, { bank: 2000, defi: 90, debt: -500 });
  assert.equal(w.total, 1590);
  assert.deepEqual(finance.savingProgress(doc, 'g1', w.total), { value: 1590, target: 5000 });
  assert.deepEqual(finance.savingProgress(doc, 'g2', w.total), { value: 390, target: 1000 });
  assert.equal(finance.savingProgress(doc, 'none', w.total), null);
});

test('removing a category frees its movements and rules; closed months keep one row each', () => {
  let doc = finance.applyOps(sample(), [{ type: 'removeCategory', id: 'food' }]);
  assert.equal(doc.rules.length, 1);
  assert.equal(finance.budget(doc, '2026-03').uncategorized.length, 2);
  doc = finance.applyOps(doc, [{ type: 'closeMonth', row: { month: '2026-02', total: 1, byKind: {} } }, { type: 'closeMonth', row: { month: '2026-02', total: 2, byKind: { bank: 2 } } }]);
  assert.deepEqual(doc.months, [{ month: '2026-02', total: 2, byKind: { bank: 2 } }]);
});

test('last month closes on its own once: when a month is first opened, never over a row already there', () => {
  const empty = finance.emptyDoc();
  assert.equal(finance.dueClose(empty, '2026-03'), null, 'nothing to count');
  let doc = finance.applyOps(empty, [{ type: 'setAccount', account: { id: 'a', name: 'Bank', kind: 'bank', currency: 'EUR', balance: 800, rate: 1, at: null, address: null } }]);
  const op = finance.dueClose(doc, '2026-01');
  assert.deepEqual(op, { type: 'closeMonth', row: { month: '2025-12', total: 800, byKind: { bank: 800 } }, ifMissing: true });
  // Another device closed it first: its row stays.
  doc = finance.applyOps(doc, [{ type: 'closeMonth', row: { month: '2025-12', total: 750, byKind: { bank: 750 } } }, /** @type {finance.Op} */ (op)]);
  assert.deepEqual(doc.months, [{ month: '2025-12', total: 750, byKind: { bank: 750 } }]);
  assert.equal(finance.dueClose(doc, '2026-01'), null);
});
