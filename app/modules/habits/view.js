// @ts-check
// Habits module (app side): habit rows (Today, area page, Habits page), the habit sheet and the month calendar
// where any past day can be marked or unmarked.
import * as domainsLib from '../../../lib/domains.js';
import * as habitsLib from '../../../lib/habits.js';
import { canEdit, dispatchHabits, domainsStore, habitsStore, inAreas, todayKey } from '../../core/data.js';
import { $, areaPicker, chipPicker, h } from '../../core/ui.js';
import { addDays, daysInMonth, isoWeekday } from '../../../lib/period.js';

/** @typedef {import('../../../lib/habits.js').Habit} Habit */
/** @typedef {import('../../../lib/habits.js').Freq} Freq */

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Every day", "3 times a week", "Mon, Thu". @param {Freq} f */
export function freqLabel(f) {
  if (f.type === 'daily') return 'Every day';
  if (f.type === 'weekly') return f.times === 1 ? 'Once a week' : `${f.times} times a week`;
  return f.days.map((d) => DAY_NAMES[d - 1]).join(', ');
}

/** Active habits, in the order they were created. */
export const activeHabits = () => habitsStore.current().habits.filter((x) => !x.archived);

/**
 * A habit's row: tick for today (not on a day it is not meant for: that is done in its calendar), its name
 * (opens its calendar) and how this week is going.
 * @param {Habit} hb @param {{ area?: string|null, freq?: boolean }} [show]  also a chip with its area, its frequency
 */
export function habitRow(hb, show = {}) {
  const today = todayKey();
  const done = habitsLib.isDoneOn(hb, today);
  const planned = habitsLib.isPlanned(hb, today);
  const week = habitsLib.weekProgress(hb, today);
  return h(
    'li',
    { class: done ? 'task habit done' : 'task habit' },
    h('input', {
      type: 'checkbox', checked: done, disabled: !canEdit() || !!hb.archived || (!planned && !done), 'aria-label': `Done today: ${hb.title}`,
      title: planned ? '' : `Not today (${freqLabel(hb.freq)})`,
      onchange: () => dispatchHabits({ type: 'mark', id: hb.id, date: today, done: !done }),
    }),
    h('button', { class: 'task-title', onclick: () => openCalendar(hb) }, hb.title),
    h(
      'span',
      { class: 'task-meta' },
      show.freq ? h('span', { class: 'hint' }, freqLabel(hb.freq)) : null,
      show.area ? h('span', { class: 'chip muted' }, show.area) : null,
      h('span', { class: week.done >= week.of ? 'chip' : 'chip muted', title: 'This week' }, `${week.done}/${week.of}`),
    ),
  );
}

// ---------------------------------------------------------------- calendar

/**
 * A habit's month calendar: tapping a day marks or unmarks it (any day up to today). Days it is not meant for
 * (habits on given weekdays) are dimmed but can still be marked.
 * @param {Habit} habit
 */
export function openCalendar(habit) {
  const dialog = /** @type {HTMLDialogElement} */ ($('habit-cal-dialog'));
  const today = todayKey();
  let month = today.slice(0, 7);

  const draw = () => {
    const hb = habitsStore.current().habits.find((x) => x.id === habit.id);
    if (!hb) return dialog.close();
    const week = habitsLib.weekProgress(hb, today);
    $('habit-cal-title').textContent = hb.title;
    $('habit-cal-sub').textContent = `${freqLabel(hb.freq)} · ${week.done}/${week.of} this week${hb.archived ? ' · archived' : ''}`;
    $('habit-cal-notes').textContent = hb.notes ?? '';
    $('habit-cal-notes').hidden = !hb.notes;
    const [y, m] = month.split('-').map(Number);
    $('cal-month').textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    /** @type {HTMLButtonElement} */ ($('cal-next')).disabled = month >= today.slice(0, 7);
    const first = `${month}-01`;
    const cells = [
      ...DAY_LETTERS.map((d) => h('span', { class: 'cal-wd', 'aria-hidden': 'true' }, d)),
      ...Array.from({ length: isoWeekday(first) - 1 }, () => h('span', {})),
    ];
    for (let i = 0; i < daysInMonth(y, m); i++) {
      const date = addDays(first, i);
      const done = habitsLib.isDoneOn(hb, date);
      const future = date > today;
      const cls = ['cal-day', done ? 'done' : '', habitsLib.isPlanned(hb, date) ? '' : 'off', date === today ? 'today' : ''].filter(Boolean).join(' ');
      cells.push(h('button', {
        type: 'button', class: cls, disabled: future || !canEdit() || !!hb.archived, 'aria-pressed': String(done),
        'aria-label': `${date}${done ? ', done' : ''}`,
        onclick: () => { dispatchHabits({ type: 'mark', id: hb.id, date, done: !done }); draw(); },
      }, String(i + 1)));
    }
    $('cal-grid').replaceChildren(...cells);

    const extra = $('habit-cal-extra');
    extra.replaceChildren(
      h('button', { type: 'button', class: 'btn', disabled: !canEdit(), onclick: () => { dialog.close(); openHabitForm(hb); } }, 'Edit'),
      h('button', { type: 'button', class: 'btn', disabled: !canEdit(), onclick: () => {
        dispatchHabits({ type: 'archive', id: hb.id, archived: !hb.archived });
        dialog.close();
      } }, hb.archived ? 'Restore' : 'Archive'),
    );
  };

  /** @param {number} delta */
  const shift = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    draw();
  };
  $('cal-prev').onclick = () => shift(-1);
  $('cal-next').onclick = () => shift(1);
  draw();
  dialog.showModal();
}

// ---------------------------------------------------------------- sheet

/** @param {Habit} [habit] @param {string} [area] area chosen in advance (e.g. from an area's page) */
export function openHabitForm(habit, area = '') {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('habit-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('habit-form'));
  const f = /** @type {any} */ (form.elements);
  const doms = domainsStore.current();
  const msg = $('habit-msg');
  msg.textContent = '';

  $('habit-dialog-title').textContent = habit ? 'Edit habit' : 'New habit';
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!habit;
  $('habit-submit').textContent = habit ? 'Save' : 'Add';
  f.title.value = habit?.title ?? '';
  f.notes.value = habit?.notes ?? '';

  let domain = habit ? domainsLib.canonical(doms, habit.domain) || habit.domain : area;
  areaPicker($('habit-areas'), doms, domain, (v) => { domain = v; });

  // How often: the kind, then the number of times or the days.
  const fr = habit?.freq ?? { type: 'daily' };
  let kind = fr.type;
  let times = fr.type === 'weekly' ? fr.times : 3;
  /** @type {Set<number>} */
  const days = new Set(fr.type === 'days' ? fr.days : []);
  const sync = () => {
    $('habit-times').hidden = kind !== 'weekly';
    $('habit-days').hidden = kind !== 'days';
  };
  chipPicker($('habit-freq'), [['daily', 'Every day'], ['weekly', 'Times a week'], ['days', 'On some days']], kind, (v) => {
    kind = /** @type {Freq['type']} */ (v);
    sync();
  });
  chipPicker($('habit-times'), [1, 2, 3, 4, 5, 6].map((n) => [String(n), `${n}×`]), String(times), (v) => { times = Number(v); });
  $('habit-days').replaceChildren(...DAY_NAMES.map((name, i) => h('button', {
    type: 'button', role: 'checkbox', class: 'chip-opt', 'aria-checked': String(days.has(i + 1)),
    onclick: (/** @type {MouseEvent} */ ev) => {
      if (days.has(i + 1)) days.delete(i + 1);
      else days.add(i + 1);
      /** @type {HTMLElement} */ (ev.currentTarget).setAttribute('aria-checked', String(days.has(i + 1)));
    },
  }, name)));
  sync();

  const extra = $('habit-extra-actions');
  extra.replaceChildren();
  if (habit) {
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      if (!confirm(`Delete “${habit.title}” and its history permanently?\n\nTo keep them, use “Archive” in its calendar.`)) return;
      dispatchHabits({ type: 'delete', id: habit.id });
      dialog.close();
    } }, 'Delete…'));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    if (!title) return f.title.focus();
    if (!domain) { msg.textContent = 'Choose an area.'; return; }
    if (kind === 'days' && !days.size) { msg.textContent = 'Choose at least one day.'; return; }
    /** @type {Freq} */
    const freq = kind === 'daily' ? { type: 'daily' } : kind === 'weekly' ? { type: 'weekly', times } : { type: 'days', days: [...days].sort() };
    const fields = { title, domain, freq, notes: String(f.notes.value).trim() || null };
    if (habit) dispatchHabits({ type: 'edit', id: habit.id, fields });
    else dispatchHabits({ type: 'add', habit: habitsLib.newHabit(fields) });
    dialog.close();
  };

  dialog.showModal();
  if (!habit) f.title.focus();
}

// ---------------------------------------------------------------- area page and Home

/** Active habits of an area (and its sub-areas; those say which one, by its name). @param {import('../index.js').AreaScope} scope */
export function areaSections({ id, ids, showSub }) {
  const doms = domainsStore.current();
  const list = activeHabits().filter((x) => inAreas(ids, x.domain));
  /** @param {Habit} x */
  const sub = (x) => {
    const own = domainsLib.canonical(doms, x.domain) || x.domain;
    return showSub && own !== id ? domainsLib.find(doms, own)?.name ?? own : null;
  };
  return list.length ? [h('ul', { class: 'rows' }, ...list.map((x) => habitRow(x, { area: sub(x), freq: true })))] : [h('p', { class: 'empty small' }, 'No habits in this area.')];
}

/** Habits add nothing to an area's card on Home. @returns {import('../index.js').HomeCard} */
export const homeCard = () => ({ stats: [], body: [] });
