// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as journal from '../lib/journal.js';
import * as crypt from '../lib/crypt.js';
import { openSync, sealSync } from '../cli/crypt.mjs';

test('journal: text and notes per day, empty days dropped, latest first', () => {
  const n1 = { id: 'n1', at: '2026-03-02T21:00:00Z', text: 'late' };
  const n0 = { id: 'n0', at: '2026-03-02T08:00:00Z', text: 'early' };
  let doc = journal.applyOps(journal.emptyDoc('UTC'), [
    { type: 'setText', date: '2026-03-01', text: 'First day.' },
    { type: 'addNote', date: '2026-03-02', note: n1 },
    { type: 'addNote', date: '2026-03-02', note: n0 },
    { type: 'addNote', date: '2026-03-02', note: n0 },
  ]);
  assert.deepEqual(doc.days.map((d) => d.date), ['2026-03-02', '2026-03-01']);
  assert.deepEqual(journal.dayOf(doc, '2026-03-02').notes.map((n) => n.id), ['n0', 'n1']);
  doc = journal.applyOps(doc, [{ type: 'editNote', date: '2026-03-02', id: 'n1', text: 'later' }, { type: 'setText', date: '2026-03-01', text: '  ' }]);
  assert.deepEqual(doc.days.map((d) => d.date), ['2026-03-02']);
  assert.equal(journal.search(doc, 'LATER').length, 1);
  assert.equal(journal.search(doc, 'nothing').length, 0);
  doc = journal.applyOps(doc, [{ type: 'removeNote', date: '2026-03-02', id: 'n0' }, { type: 'removeNote', date: '2026-03-02', id: 'n1' }]);
  assert.deepEqual(doc.days, []);
  assert.equal(journal.dayOf(doc, '2026-03-05').text, null);
});

test('journal commit messages name the days, never the text', () => {
  const msg = journal.commitMessage([{ type: 'addNote', date: '2026-03-02', note: { id: 'n', at: '', text: 'secret' } }]);
  assert.equal(msg, 'journal: note 2026-03-02');
  assert.equal(journal.commitMessage([{ type: 'setText', date: '2026-03-02', text: 'secret' }, { type: 'setText', date: '2026-03-01', text: 'x' }]), 'journal: entry 2026-03-01, 2026-03-02');
});

test('sealed files: the app (WebCrypto) and the CLI (node:crypto) open what the other seals', async () => {
  const text = JSON.stringify({ version: 1, days: [{ date: '2026-03-02', text: 'Día con ñ y emoji 🌊', notes: [] }] });
  const byApp = await crypt.seal(text, 'correct horse');
  const sealed = JSON.parse(byApp);
  assert.ok(crypt.isSealed(sealed));
  assert.ok(!byApp.includes('Día'));
  assert.equal(openSync(sealed, 'correct horse').text, text);
  const byCli = JSON.parse(sealSync(text, 'correct horse', sealed.kdf.salt));
  assert.equal(byCli.kdf.salt, sealed.kdf.salt);
  assert.notEqual(byCli.iv, sealed.iv);
  assert.equal((await crypt.open(byCli, 'correct horse')).text, text);
  await assert.rejects(crypt.open(byCli, 'wrong'), crypt.WrongPassphrase);
  assert.throws(() => openSync(sealed, 'wrong'), crypt.WrongPassphrase);
});
