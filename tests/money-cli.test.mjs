// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: ['money'], goals: [
  { id: 'g_save', kind: 'goal', title: 'Emergency fund', category: 'money', horizon: 'deadline', target: null, unit: null, deadline: '2026-12-31', progress: 0, createdAt: '2026-01-01T00:00:00Z' },
] };
const DOMAINS = { version: 1, domains: [{ id: 'money', name: 'Money', paths: [] }, { id: 'money/trading', name: 'Trading', paths: [] }] };

test('trades: add, edit the hand fields, close, panel and limits; the file is sealed and commits name no symbols', () => {
  process.env.COMPASS_PASSPHRASE = 'test passphrase';
  try {
    const { dir, run, runAll } = setup({ 'goals.json': GOALS, 'domains.json': DOMAINS });
    assert.match(run('trades'), /^No trades\.\n$/);
    run('trades', 'area', 'trading');
    run('trades', 'limits', '--day', '2', '--streak', '3');
    assert.match(run('trades', 'limits'), /day: 2 R · week: — R · losses in a row: 3/);
    const added = run('trade', 'add', '--symbol', 'ZZZUSDT', '--market', 'perp', '--qty', '2', '--entry', '100', '--at', '2026-03-02T09:00:00Z', '--order-stop', '95', '--ext', 'e1');
    const id = /\[(tr_\w+)\]/.exec(added)?.[1] ?? '';
    assert.match(added, /ZZZUSDT long Perpetual · open · no stop/);
    run('trade', 'edit', 'ZZZUSDT', '--stop-loss', '95', '--setup', 'Breakout', '--timeframe', '4h', '--errors', 'Moved the stop', '--emotion', '3');
    run('trade', 'close', id, '--exit', '110', '--pnl', '19', '--at', '2026-03-03T10:00:00Z');
    assert.match(run('trade', 'show', id), /\+1\.9 R · 19\.00 USD · Breakout 4h · errors: Moved the stop\n[^]*initial stop: 95\n  risk: 10\n/);
    run('trade', 'add', '--symbol', 'YYY', '--qty', '1', '--entry', '50', '--at', '2026-03-04T09:00:00Z', '--exit', '45', '--exit-at', '2026-03-04T12:00:00Z', '--pnl', '-5');
    const panel = run('trades', 'panel');
    assert.match(panel, /# All: 2 trades · win 50% · expectancy \+1\.9 R · total \+1\.9 R · 14\.00 USD/);
    assert.match(panel, /\(1 without a stop/);
    assert.match(panel, /## By setup\n(Breakout|—): .*\n(Breakout|—): /);
    assert.match(panel, /Moved the stop: 1/);
    assert.match(runAll('trade', 'delete', id).stderr, /--yes/);
    // Sealed, and the history only counts.
    const file = readFileSync(join(dir, 'a', 'trades.json'), 'utf8');
    assert.match(file, /"sealed": "AES-256-GCM"/);
    assert.doesNotMatch(file, /ZZZ|Breakout/);
    const log = git(join(dir, 'a'), 'log', '--format=%s');
    assert.doesNotMatch(log, /ZZZ|YYY|Breakout|19/);
    assert.match(log, /trades: 1 new/);
  } finally {
    delete process.env.COMPASS_PASSPHRASE;
  }
});

test('money: categories, rules, movements, budget, net worth with trading, month close and a savings goal', () => {
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
    run('trades', 'account', 'ex', '--balance', '1000', '--rate', '0.9');
    assert.match(run('money'), /Net worth: 2,400\.00 EUR \(bank 2,000\.00 · debt -500\.00 · trading 900\.00\)/);
    run('money', 'close', '2026-02');
    assert.match(run('money', 'history'), /2026-02: 2,400\.00/);
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
