// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { git, setup } from './helpers.mjs';

const GOALS = { version: 1, timeZone: 'UTC', categories: [], goals: [] };

test('journal: write, notes, show, days and search; the file in the repo is sealed', () => {
  process.env.COMPASS_PASSPHRASE = 'test passphrase';
  try {
    const { dir, run, runAll } = setup({ 'goals.json': GOALS });
    assert.match(run('journal'), /^# \d{4}-\d{2}-\d{2}\n\(nothing written\)\n$/);
    assert.match(run('journal', 'write', 'A quiet day by the sea.'), /^journal: entry \d{4}-\d{2}-\d{2}\n$/);
    run('journal', 'note', 'Called home');
    run('journal', 'write', 'Earlier day.', '--date', 'yesterday');
    const today = run('journal');
    assert.match(today, /A quiet day by the sea\.\n- Called home \[n_\w+\]\n$/);
    assert.match(run('journal', 'days', '--last', '2'), /# .*\nA quiet day.*\n- .*\n\n# .*\nEarlier day\.\n$/);
    assert.match(run('journal', 'search', 'sea'), /quiet day/);
    assert.doesNotMatch(run('journal', 'search', 'sea'), /Earlier/);
    assert.match(runAll('journal', 'note', 'x', '--date', 'tomorrow').stderr, /has not come yet/);
    const id = /\[(n_\w+)\]/.exec(today)?.[1];
    run('journal', 'unnote', /** @type {string} */ (id));
    assert.doesNotMatch(run('journal'), /Called home/);
    // The repo only holds the sealed form, and commit messages only dates.
    const file = readFileSync(join(dir, 'a', 'journal.json'), 'utf8');
    assert.match(file, /"sealed": "AES-256-GCM"/);
    assert.doesNotMatch(file, /quiet day|by the sea|Called home/);
    assert.doesNotMatch(git(join(dir, 'a'), 'log', '--format=%s'), /quiet day|by the sea|Called home/);
    // A wrong password opens nothing.
    process.env.COMPASS_PASSPHRASE = 'wrong';
    assert.match(runAll('journal').stderr, /does not open this file/);
  } finally {
    delete process.env.COMPASS_PASSPHRASE;
  }
});
