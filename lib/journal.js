// @ts-check
// Data model of journal.json and edit operations (same shape as the other data files: normalize, applyOps
// re-applied on the latest version, serialize, commitMessage). The file is sealed with the user's passphrase
// (lib/crypt.js): this module only sees it open.
//
// One entry per day: a free text, plus short notes with the time they were written. Commit messages are not
// encrypted, so they name only the day, never the text.

import { isDate } from './period.js';
import { newId, serialize } from './goals.js';

export { newId, serialize };

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} at     ISO 8601, when it was written
 * @property {string} text
 */

/**
 * @typedef {Object} Day
 * @property {string} date   YYYY-MM-DD
 * @property {string|null} text
 * @property {Note[]} notes  oldest first
 */

/**
 * @typedef {Object} JournalDoc
 * @property {number} version
 * @property {string} [timeZone]  IANA zone of the civil dates
 * @property {Day[]} days         latest first
 */

/**
 * @typedef {{ type: 'setText', date: string, text: string|null }
 *   | { type: 'addNote', date: string, note: Note }
 *   | { type: 'editNote', date: string, id: string, text: string }
 *   | { type: 'removeNote', date: string, id: string }
 *   | { type: 'setTimeZone', timeZone: string }} Op
 */

/** @param {string} [timeZone] @returns {JournalDoc} */
export function emptyDoc(timeZone) {
  return { version: 1, ...(timeZone ? { timeZone } : {}), days: [] };
}

/** @param {unknown} v */
const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** A day with nothing in it is not kept. @param {Day} d */
const isEmpty = (d) => !d.text && !d.notes.length;

/** @param {Day[]} days */
const tidy = (days) => days.filter((d) => !isEmpty(d)).sort((a, b) => b.date.localeCompare(a.date));

/**
 * Normalizes a document that was read (tolerates missing fields; drops bad days and notes).
 * @param {any} raw
 * @returns {JournalDoc}
 */
export function normalize(raw) {
  const doc = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  /** @type {Map<string, Day>} */
  const byDate = new Map();
  for (const x of Array.isArray(doc.days) ? doc.days : []) {
    if (!x || !isDate(x.date) || byDate.has(x.date)) continue;
    const notes = (Array.isArray(x.notes) ? x.notes : [])
      .filter((/** @type {any} */ n) => n && typeof n.id === 'string' && typeof n.at === 'string' && textOrNull(n.text))
      .map((/** @type {any} */ n) => ({ id: n.id, at: n.at, text: n.text }))
      .sort((/** @type {Note} */ a, /** @type {Note} */ b) => a.at.localeCompare(b.at));
    byDate.set(x.date, { date: x.date, text: textOrNull(x.text), notes });
  }
  return { ...doc, version: Number(doc.version) || 1, days: tidy([...byDate.values()]) };
}

/** A day of the journal (empty if nothing was written). @param {JournalDoc} doc @param {string} date @returns {Day} */
export const dayOf = (doc, date) => doc.days.find((d) => d.date === date) ?? { date, text: null, notes: [] };

/** A new note written now. @param {string} text @param {Date} [now] @returns {Note} */
export const newNote = (text, now = new Date()) => ({ id: newId('n_'), at: now.toISOString(), text });

/**
 * Days whose text or notes contain a word (ignoring case).
 * @param {JournalDoc} doc @param {string} query
 */
export function search(doc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return doc.days;
  return doc.days.filter((d) => d.text?.toLowerCase().includes(q) || d.notes.some((n) => n.text.toLowerCase().includes(q)));
}

/**
 * Applies operations to a copy of the document. Edits of notes that no longer exist are ignored.
 * @param {JournalDoc} doc
 * @param {Op[]} ops
 * @returns {JournalDoc}
 */
export function applyOps(doc, ops) {
  /** @type {JournalDoc} */
  const out = structuredClone(doc);
  /** @param {string} date */
  const day = (date) => {
    let d = out.days.find((x) => x.date === date);
    if (!d) out.days.push((d = { date, text: null, notes: [] }));
    return d;
  };
  for (const op of ops) {
    switch (op.type) {
      case 'setText':
        if (isDate(op.date)) day(op.date).text = textOrNull(op.text);
        break;
      case 'addNote': {
        if (!isDate(op.date) || !textOrNull(op.note.text)) break;
        const d = day(op.date);
        if (!d.notes.some((n) => n.id === op.note.id)) d.notes = [...d.notes, structuredClone(op.note)].sort((a, b) => a.at.localeCompare(b.at));
        break;
      }
      case 'editNote': {
        const n = out.days.find((x) => x.date === op.date)?.notes.find((x) => x.id === op.id);
        if (n && textOrNull(op.text)) n.text = op.text;
        break;
      }
      case 'removeNote': {
        const d = out.days.find((x) => x.date === op.date);
        if (d) d.notes = d.notes.filter((n) => n.id !== op.id);
        break;
      }
      case 'setTimeZone':
        out.timeZone = op.timeZone;
        break;
    }
  }
  out.days = tidy(out.days);
  return out;
}

/**
 * Commit message: only the days touched, never what was written (commit messages are not encrypted).
 * @param {Op[]} ops
 */
export function commitMessage(ops) {
  const dates = [...new Set(ops.flatMap((op) => ('date' in op ? [op.date] : [])))].sort();
  const what = ops.every((op) => op.type === 'addNote') ? 'note' : 'entry';
  return `journal: ${dates.length ? `${what} ${dates.join(', ')}` : 'update'}`;
}
