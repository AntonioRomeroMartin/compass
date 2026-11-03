// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };
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
