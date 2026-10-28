// @ts-check
// Journal (app side): a day's editor (its text and its notes with the time), used at the end of Today and on the
// Journal page; that page (one day at a time, the other days below, search); and the encryption password of this
// device, without which the journal is neither read nor written.
import * as journalLib from '../../../lib/journal.js';
import { canEdit, dispatchJournal, journalStore, passphrase, persist, render, setPassphrase, state, todayKey, tz } from '../../core/data.js';
import { $, h } from '../../core/ui.js';
import { addDays } from '../../../lib/period.js';

/** @typedef {import('../../../lib/journal.js').Day} Day */

/** Text being typed, by day, until it is saved (a redraw meanwhile keeps it). @type {Map<string, string>} */
const drafts = new Map();

/** "21:05" in the data's zone. @param {string} iso */
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz() });

/** "Wednesday 28 October". @param {string} date */
export const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Why the journal cannot be shown, as a block with what to do; null if it can.
 * @returns {HTMLElement|null}
 */
function lockedBlock() {
  if (!passphrase()) {
    return h('div', { class: 'journal-locked' },
      h('p', { class: 'hint' }, 'The journal is encrypted with your own password before it is saved. Set it on this device to start.'),
      h('button', { class: 'btn', onclick: openPassphrase }, 'Set encryption password'));
  }
  const err = journalStore.state.error;
  if (err) {
    return h('div', { class: 'journal-locked' },
      h('p', { class: 'msg' }, err),
      h('button', { class: 'btn', onclick: openPassphrase }, 'Change password on this device'));
  }
  if (!journalStore.state.loaded) return h('p', { class: 'hint' }, 'Opening the journal…');
  return null;
}

/**
 * Editor of one day: its text (saved when you leave the field) and its notes with the time, oldest first.
 * The ids let a redraw put the cursor back where it was.
 * @param {string} date
 */
export function dayEditor(date) {
  const day = journalLib.dayOf(journalStore.current(), date);
  const edit = canEdit();
  const text = h('textarea', {
    id: `journal-text-${date}`, class: 'journal-text', rows: 4, maxlength: 20000, disabled: !edit,
    placeholder: date === todayKey() ? 'How was today?' : 'What happened that day?', 'aria-label': `Journal of ${date}`,
  });
  text.value = drafts.get(date) ?? day.text ?? '';
  text.addEventListener('input', () => drafts.set(date, text.value));
  text.addEventListener('change', () => {
    const value = text.value.trim() || null;
    // After the focus has moved (to the note field, say), so the redraw that saving brings keeps it there.
    setTimeout(() => {
      drafts.delete(date);
      if (value !== day.text) dispatchJournal({ type: 'setText', date, text: value });
    }, 0);
  });

  const note = h('input', { id: `journal-note-${date}`, maxlength: 2000, autocomplete: 'off', disabled: !edit, placeholder: 'Add a note…', 'aria-label': 'New note' });
  const add = () => {
    const t = note.value.trim();
    if (!t) return;
    note.value = '';
    dispatchJournal({ type: 'addNote', date, note: journalLib.newNote(t) });
  };
  note.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    add();
  });

  return h(
    'div',
    { class: 'journal-day' },
    text,
    day.notes.length ? h('ul', { class: 'journal-notes' }, ...day.notes.map((n) => h(
      'li',
      {},
      h('span', { class: 'hint time' }, timeOf(n.at)),
      h('span', { class: 'note-text' }, n.text),
      h('button', { type: 'button', class: 'link danger', disabled: !edit, 'aria-label': 'Remove note', onclick: () => {
        if (confirm('Remove this note?')) dispatchJournal({ type: 'removeNote', date, id: n.id });
      } }, '×'),
    ))) : null,
    h('div', { class: 'note-add' }, note, h('button', { type: 'button', class: 'btn small', disabled: !edit, onclick: add }, 'Add')),
  );
}

/** Opens the Journal page on a day. @param {string} [date] */
export function openJournal(date) {
  state.tab = 'journal';
  state.journalDate = date ?? todayKey();
  persist();
  render();
  window.scrollTo(0, 0);
}

/** The Journal block at the end of Today. */
export function todaySection() {
  const head = h('h2', {}, 'Journal', h('button', { class: 'link sub', onclick: () => openJournal() }, 'All days ›'));
  return h('section', { class: 'group journal' }, head, lockedBlock() ?? dayEditor(todayKey()));
}

/** A past day in the list: its date, the start of its text and how many notes. @param {Day} d */
function dayCard(d) {
  return h(
    'li',
    {},
    h('button', { class: 'journal-card', onclick: () => openJournal(d.date) },
      h('span', { class: 'journal-card-date' }, dayLabel(d.date), d.notes.length ? h('span', { class: 'hint' }, ` · ${d.notes.length} note${d.notes.length > 1 ? 's' : ''}`) : null),
      d.text ? h('span', { class: 'journal-card-text' }, d.text) : null),
  );
}

/** The Journal page: one day (‹ date ›) to read and write, then search and the other days. */
export function renderJournalView() {
  const view = $('view-journal');
  view.replaceChildren();
  if (!state.cfg) return;
  const locked = lockedBlock();
  if (locked) {
    view.append(locked);
    return;
  }
  const today = todayKey();
  const date = state.journalDate && state.journalDate <= today ? state.journalDate : today;
  /** @param {string} d */
  const go = (d) => openJournal(d);
  view.append(
    h('div', { class: 'cal-head journal-nav' },
      h('button', { class: 'icon', 'aria-label': 'Previous day', onclick: () => go(addDays(date, -1)) }, '‹'),
      h('strong', {}, date === today ? `Today · ${dayLabel(date)}` : dayLabel(date)),
      h('button', { class: 'icon', 'aria-label': 'Next day', disabled: date >= today, onclick: () => go(addDays(date, 1)) }, '›')),
    dayEditor(date),
  );

  const search = h('input', { type: 'search', id: 'journal-search', value: state.journalQuery ?? '', placeholder: 'Search the journal', 'aria-label': 'Search the journal' });
  search.addEventListener('input', () => {
    state.journalQuery = search.value;
    render();
  });
  const doc = journalStore.current();
  const list = journalLib.search(doc, state.journalQuery ?? '').filter((d) => d.date !== date);
  view.append(
    h('section', { class: 'group' },
      h('h2', {}, 'Other days', h('span', { class: 'sub' }, String(list.length))),
      search,
      list.length ? h('ul', { class: 'journal-list' }, ...list.map(dayCard)) : h('p', { class: 'empty small' }, state.journalQuery ? 'Nothing found.' : 'No other days yet.')),
    h('p', { class: 'hint' }, h('button', { class: 'link', onclick: openPassphrase }, 'Encryption password on this device')),
  );
}

/** Sets, changes or forgets the encryption password of this device. */
export function openPassphrase() {
  const dialog = /** @type {HTMLDialogElement} */ ($('passphrase-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('passphrase-form'));
  const f = /** @type {any} */ (form.elements);
  f.pass.value = '';
  f.pass.type = 'password';
  $('passphrase-state').textContent = passphrase() ? 'This device has a password set. A new one replaces it here only.' : 'No password on this device yet.';
  /** @type {HTMLButtonElement} */ ($('passphrase-forget')).hidden = !passphrase();
  $('passphrase-forget').onclick = () => {
    if (!confirm('Forget the encryption password on this device? The journal stays encrypted in your repo.')) return;
    setPassphrase(null);
    dialog.close();
  };
  $('passphrase-show').onclick = () => { f.pass.type = f.pass.type === 'password' ? 'text' : 'password'; };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const pass = String(f.pass.value);
    if (pass.length < 8) {
      $('passphrase-state').textContent = 'Use at least 8 characters (a few words is best).';
      return f.pass.focus();
    }
    setPassphrase(pass);
    dialog.close();
  };
  dialog.showModal();
  f.pass.focus();
}
