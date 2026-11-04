// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: ['money'], goals: [
  { id: 'g_save', kind: 'goal', title: 'Emergency fund', category: 'money', horizon: 'deadline', target: null, unit: null, deadline: '2026-12-31', progress: 0, createdAt: '2026-01-01T00:00:00Z' },
] };
const DOMAINS = { version: 1, domains: [{ id: 'money', name: 'Money', paths: [] }] };

test('money: categories, rules, movements, budget, net worth, month close and a savings goal', () => {
  process.env.COMPASS_PASSPHRASE = 'test passphrase';
  try {
    const { dir, run, read } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
    run('money', 'category', 'add', 'Food', '--limit', '300');
    run('money', 'category', 'add', 'Fun');
    run('money', 'rule', 'add', 'market', 'food');
    run('money', 'rule', 'add', 'to savings', 'transfer');
    const month = new Date().toISOString().slice(0, 7);
    run('money', 'add', '--amount', '1500', '--text', 'Salary', '--date', `${month}-01`);
    run('money', 'add', '--amount', '-120', '--text', 'Super Market', '--date', `${month}-01`);
    run('money', 'add', '--amount', '-500', '--text', 'Move to savings', '--date', `${month}-01`);
    run('money', 'add', '--amount', '-30', '--text', 'Bookshop', '--date', `${month}-01`);
    const out = run('money');
    assert.match(out, /spent 120\.00 of 300\.00 · income 1,500\.00 · expenses 150\.00 · saved 1,350\.00/);
    assert.match(out, /Food: 120\.00 of 300\.00\nFun: 0\.00\n1 uncategorized/);
    const mid = /\[(m_\w+)\]/.exec(run('money', 'uncategorized'))?.[1] ?? '';
    run('money', 'categorize', mid, 'Fun');
    assert.doesNotMatch(run('money'), /uncategorized/);
    run('money', 'account', 'set', 'bank', '--kind', 'bank', '--balance', '2000');
    run('money', 'account', 'set', 'loan', '--kind', 'debt', '--balance', '500');
    assert.match(run('money'), /Net worth: 1,500\.00 EUR \(bank 2,000\.00 · debt -500\.00\)/);
    // Last month's row was kept on its own when finance was opened with balances; `close` rewrites one.
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).toISOString().slice(0, 7);
    assert.match(run('money', 'history'), new RegExp(`^${last}: 2,000\\.00 \\(bank 2,000\\.00\\)`));
    run('money', 'close', '2026-02');
    assert.match(run('money', 'history'), /2026-02: 1,500\.00/);
    // A savings goal: its figures in the sealed file, only "counted from net worth" in goals.json.
    run('money', 'saving', 'Emergency', 'networth', '5000');
    assert.equal(read('a').goals[0].source, 'savings');
    const fin = readFileSync(join(dir, 'a', 'finance.json'), 'utf8');
    assert.doesNotMatch(fin, /Salary|5000|Food/);
    assert.doesNotMatch(git(join(dir, 'a'), 'log', '--format=%s'), /Salary|Food|1500|5000/);
  } finally {
    delete process.env.COMPASS_PASSPHRASE;
  }
});
