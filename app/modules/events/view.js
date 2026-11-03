// @ts-check
// Events module (app side): event rows (Today and the area page), the new/edit sheet and the area's card on Home.
// Moving an event moves its open tasks (`task.event`) by the same days. The calendar copy is kept by the sync
// (lib/calendar.js), not by the app.
import * as domainsLib from '../../../lib/domains.js';
import * as eventsLib from '../../../lib/events.js';
import { canEdit, dispatchEvents, domainsStore, eventsStore, inAreas, tasksStore, todayKey } from '../../core/data.js';
import { $, areaPicker, h } from '../../core/ui.js';
import { daysUntil } from '../../../lib/period.js';

/** @typedef {import('../../../lib/events.js').Event} Event */

/**
 * An event's row: when, title, place; how far it is.
 * @param {Event} e @param {{ area?: string|null }} [show]  also a chip with its area
 */
export function eventRow(e, show = {}) {
  const d = daysUntil(eventsLib.dayOf(e.start), todayKey(), 'UTC');
  const when = d <= 0 ? 'now' : d === 1 ? 'tomorrow' : `in ${d} d`;
  return h(
    'li',
    { class: 'task event' },
    h('span', { class: 'event-mark', 'aria-hidden': 'true' }, '◷'),
    h(
      'button',
      { class: 'task-title', disabled: !canEdit(), onclick: () => openEventForm('', e) },
      e.title,
      h('span', { class: 'hint' }, ` ${eventsLib.whenText(e)}${e.location ? ` · ${e.location}` : ''}`),
    ),
    h(
      'span',
      { class: 'task-meta' },
      show.area ? h('span', { class: 'chip muted' }, show.area) : null,
      h('span', { class: d <= 0 ? 'chip warn' : 'chip' }, when),
    ),
  );
}

/** Has any of these areas an event to come? @param {Set<string>} ids */
export const hasEvents = (ids) => eventsLib.upcoming(eventsStore.current(), todayKey()).some((e) => inAreas(ids, e.domain));

/**
 * New event, or edit one: title, area, day, times (none: all day), last day, place and notes.
 * @param {string} [area] area chosen in advance @param {Event} [event]
 */
export function openEventForm(area = '', event) {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('event-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('event-form'));
  const f = /** @type {any} */ (form.elements);
  const doms = domainsStore.current();
  const msg = $('event-msg');
  msg.textContent = '';

  $('event-form-title').textContent = event ? 'Edit event' : 'New event';
  $('event-submit').textContent = event ? 'Save' : 'Add';
  f.title.value = event?.title ?? '';
  f.date.value = event ? eventsLib.dayOf(event.start) : todayKey();
  const timed = event && !eventsLib.isAllDay(event.start);
  f.from.value = timed ? eventsLib.timeOf(event.start) : '';
  f.to.value = timed && event.end ? eventsLib.timeOf(event.end) : '';
  f.until.value = event?.end && eventsLib.dayOf(event.end) !== eventsLib.dayOf(event.start) ? eventsLib.dayOf(event.end) : '';
  f.location.value = event?.location ?? '';
  f.notes.value = event?.notes ?? '';

  let domain = event ? domainsLib.canonical(doms, event.domain) || event.domain : area;
  areaPicker($('event-areas'), doms, domain, (v) => { domain = v; });

  const extra = $('event-form-extra');
  extra.replaceChildren();
  if (event) {
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      if (!confirm(`Delete “${event.title}” (and its calendar copy on the next sync)?`)) return;
      dispatchEvents({ type: 'delete', id: event.id });
      const linked = tasksStore.current().tasks.filter((t) => t.event === event.id);
      if (linked.length) tasksStore.dispatch(linked.map((t) => ({ type: 'edit', id: t.id, fields: { event: null } })));
      dialog.close();
    } }, 'Delete…'));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    if (!title) return f.title.focus();
    if (!domain) { msg.textContent = 'Choose an area.'; return; }
    const from = String(f.from.value);
    const to = String(f.to.value);
    /** @type {{ start: string, end: string|null }} */
    let when;
    try {
      when = eventsLib.parseWhen(String(f.date.value), from ? (to ? `${from}-${to}` : from) : null, f.until.value ? String(f.until.value) : null);
    } catch (e) {
      msg.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    const fields = { title, domain, ...when, location: String(f.location.value).trim() || null, notes: String(f.notes.value).trim() || null };
    if (event) {
      dispatchEvents({ type: 'edit', id: event.id, fields });
      const moves = eventsLib.tasksToMove(tasksStore.current(), event.id, event.start, when.start);
      if (moves.length) tasksStore.dispatch(moves);
    } else {
      dispatchEvents({ type: 'add', event: eventsLib.newEvent(fields) });
    }
    dialog.close();
  };

  dialog.showModal();
  if (!event) f.title.focus();
}

/** Events to come in an area (and its sub-areas; those say which one). @param {import('../index.js').AreaScope} scope */
export function areaSections({ id, ids, showSub }) {
  const doms = domainsStore.current();
  const list = eventsLib.upcoming(eventsStore.current(), todayKey()).filter((e) => inAreas(ids, e.domain));
  /** @param {Event} e */
  const sub = (e) => {
    const own = domainsLib.canonical(doms, e.domain) || e.domain;
    return showSub && own !== id ? domainsLib.find(doms, own)?.name ?? own : null;
  };
  if (!list.length) return [h('p', { class: 'empty small' }, 'No events to come.')];
  return [h('ul', { class: 'rows' }, ...list.map((e) => eventRow(e, { area: sub(e) })))];
}

/** The next events of an area on its Home card. @param {import('../index.js').AreaScope} scope */
export function homeCard({ ids }) {
  const list = eventsLib.upcoming(eventsStore.current(), todayKey()).filter((e) => inAreas(ids, e.domain));
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['events', list.length]];
  const lines = list.slice(0, 3).map((e) => h('li', { class: 'mini' }, h('span', { class: 'mini-title' }, e.title), h('span', { class: 'hint' }, eventsLib.whenText(e))));
  return { stats, body: lines.length ? [h('ul', { class: 'mini-list' }, ...lines)] : [] };
}
