// @ts-check
// Tasks module (app side): task rows, the task sheet, and its parts of the area page and the Home card.
import * as tasksLib from '../../../lib/tasks.js';
import * as domainsLib from '../../../lib/domains.js';
import { canEdit, current, dispatchGoals, domainsStore, inAreas, tasksStore, todayKey, tz } from '../../core/data.js';
import { $, chipPicker, editRow, h } from '../../core/ui.js';
import { goalKey, isExpired, newId } from '../../../lib/goals.js';
import { addDays, daysUntil, endOfWeek, periodKey } from '../../../lib/period.js';

/** @typedef {import('../../../lib/tasks.js').Task} Task */

/** @param {Task} t */
export function toggleTask(t) {
  if (!canEdit()) return;
  const now = new Date();
  if (t.status === 'open') {
    tasksStore.dispatch([{ type: 'done', id: t.id, at: now.toISOString(), today: todayKey(), nextId: t.repeat ? newId('t_') : null }]);
  } else {
    tasksStore.dispatch([{ type: 'reopen', id: t.id }]);
  }
  // A task linked to a goal adds (or takes back) 1.
  const g = t.goal ? current().goals.find((x) => x.id === t.goal) : null;
  if (g) dispatchGoals({ type: 'inc', id: g.id, key: goalKey(g, now, tz()), delta: t.status === 'open' ? 1 : -1 });
}

/** @param {Task} t @param {boolean} [showArea] */
export function taskRow(t, showArea = false) {
  const doms = domainsStore.current();
  const d = t.due ? daysUntil(t.due, new Date(), tz()) : null;
  const when = d === null ? null : d < 0 ? `${-d}d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : t.due;
  const done = t.status !== 'open';
  return h(
    'li',
    { class: done ? 'task done' : 'task' },
    h('input', { type: 'checkbox', checked: done, disabled: !canEdit(), 'aria-label': `Done: ${t.title}`, onchange: () => toggleTask(t) }),
    h('button', { class: 'task-title', disabled: !canEdit(), onclick: () => openTaskForm(t) }, t.title),
    h(
      'span',
      { class: 'task-meta' },
      t.subtasks.length ? h('span', { class: 'chip muted' }, `${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}`) : null,
      showArea ? h('span', { class: 'chip muted' }, domainsLib.label(doms, domainsLib.canonical(doms, t.domain)) || t.domain) : null,
      when ? h('span', { class: d !== null && d < 0 ? 'chip danger' : d === 0 ? 'chip warn' : 'chip' }, when) : null,
      t.repeat ? h('span', { class: 'chip muted', title: tasksLib.repeatText(t.repeat) }, '↻') : null,
    ),
  );
}

/** Choices of the "When" chips; "pick" shows the date field. */
export const WHEN = /** @type {const} */ ([['none', 'No date'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['nextweek', 'Next week'], ['pick', 'Pick date…']]);

/** @param {string} today */
export function nextMonday(today) {
  for (let i = 1; i <= 7; i++) {
    const d = tasksLib.parseDue(`+${i}`, today);
    if (d && new Date(`${d}T12:00:00Z`).getUTCDay() === 1) return d;
  }
  return today;
}

/** @param {Task} [task] @param {string} [domain] area chosen in advance (e.g. from an area's page) */
export function openTaskForm(task, domain) {
  if (!canEdit()) return;
  const dialog = /** @type {HTMLDialogElement} */ ($('task-dialog'));
  const form = /** @type {HTMLFormElement} */ ($('task-form'));
  const f = /** @type {any} */ (form.elements);
  const doms = domainsStore.current();
  const today = todayKey();
  const msg = $('task-msg');
  msg.textContent = '';

  $('task-dialog-title').textContent = task ? 'Edit task' : 'New task';
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!task;
  $('task-submit').textContent = task ? 'Save' : 'Add';
  f.title.value = task?.title ?? '';

  // Area: parents followed by their sub-areas.
  let area = task ? domainsLib.canonical(doms, task.domain) || task.domain : domain ?? '';
  /** @type {[string, string][]} */
  const areaItems = [];
  /** @param {string|undefined} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const d of doms.domains.filter((x) => (x.parent ?? '') === (parent ?? ''))) {
      areaItems.push([d.id, d.name]);
      walk(d.id, depth + 1);
    }
  };
  walk(undefined, 0);
  if (area && !areaItems.some(([id]) => id === area)) areaItems.push([area, area]);
  chipPicker($('task-areas'), areaItems, area, (v) => { area = v; });
  for (const b of $('task-areas').querySelectorAll('button')) {
    const d = domainsLib.find(doms, /** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.v));
    if (d?.parent) b.classList.add('sub');
  }

  // When.
  const due = task?.due ?? null;
  const preset = !due ? 'none' : due === today ? 'today' : due === tasksLib.parseDue('tomorrow', today) ? 'tomorrow' : 'pick';
  let when = /** @type {string} */ (preset);
  f.due.value = due ?? '';
  f.due.hidden = when !== 'pick';
  chipPicker($('task-when'), WHEN.map(([v, t]) => [v, t]), when, (v) => {
    when = v;
    f.due.hidden = v !== 'pick';
    if (v === 'pick') { if (!f.due.value) f.due.value = today; f.due.focus(); }
    syncRepeatHint();
  });

  // More options.
  const r = task?.repeat ?? null;
  const rText = r ? tasksLib.repeatText(r) : '';
  f.repeat.value = !r ? '' : rText === 'daily' ? 'daily' : rText === 'weekly mon,tue,wed,thu,fri' ? 'weekdays' : 'custom';
  f.repeatCustom.value = f.repeat.value === 'custom' ? rText : '';
  f.notes.value = task?.notes ?? '';
  const now = new Date();
  const goals = current().goals.filter((g) => !g.archived && !isExpired(g, now, tz()));
  f.goal.replaceChildren(h('option', { value: '' }, 'None'), ...goals.map((g) => h('option', { value: g.id }, g.title)));
  f.goal.value = task?.goal && goals.some((g) => g.id === task.goal) ? task.goal : '';
  f.location.value = task?.location ?? '';
  const subList = $('subtask-list');
  subList.replaceChildren(...(task?.subtasks ?? []).map((st) => editRow(st.id, st.title, 'Step', 'add-subtask')));
  $('add-subtask').onclick = () => {
    const row = editRow('', '', 'Step', 'add-subtask');
    subList.append(row);
    /** @type {HTMLInputElement} */ (row.querySelector('input')).focus();
  };
  /** @type {HTMLDetailsElement} */ ($('task-more')).open = false;

  const dueValue = () => (when === 'none' ? null : when === 'today' ? today : when === 'tomorrow' ? tasksLib.parseDue('tomorrow', today)
    : when === 'nextweek' ? nextMonday(today) : String(f.due.value) || null);
  /** The rule chosen, or an Error. */
  const repeatValue = () => {
    const kind = String(f.repeat.value);
    const text = kind === 'custom' ? String(f.repeatCustom.value) : kind;
    try {
      return tasksLib.parseRepeat(text, dueValue() ?? today);
    } catch (e) {
      return /** @type {Error} */ (e);
    }
  };
  function syncRepeatHint() {
    $('field-repeat-custom').hidden = f.repeat.value !== 'custom';
    const rule = repeatValue();
    $('task-repeat-hint').textContent = rule instanceof Error ? rule.message
      : rule ? `Repeats ${tasksLib.repeatText(rule)}: when you complete it, the next one is created.` : '';
  }
  f.repeat.onchange = syncRepeatHint;
  f.repeatCustom.oninput = syncRepeatHint;
  f.due.onchange = syncRepeatHint;
  syncRepeatHint();

  const extra = $('task-extra-actions');
  extra.replaceChildren();
  if (task) {
    if (task.status === 'open') {
      extra.append(h('button', { type: 'button', class: 'btn', onclick: () => {
        const stop = !!task.repeat && confirm('Stop repeating it too?\n\nOK: no more copies. Cancel: drop only this one.');
        tasksStore.dispatch([{ type: 'drop', id: task.id, at: new Date().toISOString(), today, nextId: task.repeat && !stop ? newId('t_') : null }]);
        dialog.close();
      } }, 'Drop'));
    } else {
      extra.append(h('button', { type: 'button', class: 'btn', onclick: () => { tasksStore.dispatch([{ type: 'reopen', id: task.id }]); dialog.close(); } }, 'Reopen'));
    }
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      if (!confirm(`Delete “${task.title}” permanently?\n\nTo keep a record, use “Drop”.`)) return;
      tasksStore.dispatch([{ type: 'delete', id: task.id }]);
      dialog.close();
    } }, 'Delete…'));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const title = String(f.title.value).trim();
    if (!title) return f.title.focus();
    if (!area) { msg.textContent = 'Choose an area.'; return; }
    if (when === 'pick' && !f.due.value) { msg.textContent = 'Pick a date.'; return; }
    const rule = repeatValue();
    if (rule instanceof Error) { /** @type {HTMLDetailsElement} */ ($('task-more')).open = true; msg.textContent = rule.message; return; }
    const fields = {
      title,
      domain: area,
      due: dueValue(),
      repeat: rule,
      notes: String(f.notes.value).trim() || null,
      goal: String(f.goal.value) || null,
      location: String(f.location.value).trim() || null,
    };
    const rows = Array.from(subList.querySelectorAll('li'), (li) => ({
      id: li.dataset.id ?? '',
      title: /** @type {HTMLInputElement} */ (li.querySelector('input')).value.trim(),
    })).filter((x) => x.title);
    if (task) {
      const old = task.subtasks;
      /** @type {import('../../../lib/tasks.js').Op[]} */
      const ops = [
        { type: 'edit', id: task.id, fields },
        ...old.filter((x) => !rows.some((r) => r.id === x.id)).map((x) => /** @type {const} */ ({ type: 'removeSub', id: task.id, subId: x.id })),
        ...rows.flatMap((r) => {
          const prev = old.find((x) => x.id === r.id);
          if (!prev) return [/** @type {const} */ ({ type: 'addSub', id: task.id, sub: { id: newId('s_'), title: r.title, done: false } })];
          return prev.title === r.title ? [] : [/** @type {const} */ ({ type: 'editSub', id: task.id, subId: r.id, title: r.title })];
        }),
      ];
      tasksStore.dispatch(ops);
    } else {
      const t = tasksLib.newTask({ ...fields, subtasks: rows.map((r) => ({ id: newId('s_'), title: r.title, done: false })) });
      tasksStore.dispatch([{ type: 'add', task: t }]);
    }
    dialog.close();
  };

  dialog.showModal();
  if (!task) f.title.focus();
}

// ---------------------------------------------------------------- area page and Home

/** Civil date when a closed task was closed. @param {Task} t */
const closedOn = (t) => (t.doneAt ? periodKey('day', new Date(t.doneAt), tz()) : '');

/**
 * Open tasks by date (overdue, today, this week, later, no date) and, folded, what was closed in the last 7 days.
 * @param {import('../index.js').AreaScope} scope
 */
export function areaSections({ id, ids, showSub }) {
  const doms = domainsStore.current();
  const today = todayKey();
  const weekEnd = endOfWeek(today);
  const all = tasksStore.current().tasks.filter((t) => inAreas(ids, t.domain));
  const open = all.filter((t) => t.status === 'open').sort(tasksLib.byDue);
  const since = addDays(today, -7);
  const recent = all
    .filter((t) => t.status !== 'open' && closedOn(t) >= since)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  /** @type {[string, Task[]][]} */
  const buckets = [
    ['Overdue', open.filter((t) => t.due && t.due < today)],
    ['Today', open.filter((t) => t.due === today)],
    ['This week', open.filter((t) => t.due && t.due > today && t.due <= weekEnd)],
    ['Later', open.filter((t) => t.due && t.due > weekEnd)],
    ['No date', open.filter((t) => !t.due)],
  ];
  /** @type {HTMLElement[]} */
  const out = [];
  for (const [title, list] of buckets) {
    if (!list.length) continue;
    out.push(h('section', { class: 'group' }, h('h2', {}, title, h('span', { class: 'sub' }, String(list.length))),
      h('ul', { class: 'rows' }, ...list.map((t) => taskRow(t, showSub && domainsLib.canonical(doms, t.domain) !== id)))));
  }
  if (!open.length) out.push(h('p', { class: 'empty small' }, 'No open tasks here.'));
  if (recent.length) {
    out.push(h(
      'details',
      { class: 'group undated' },
      h('summary', {}, h('h2', {}, 'Done in the last 7 days', h('span', { class: 'sub' }, String(recent.length)))),
      h('ul', { class: 'rows' }, ...recent.map((t) => taskRow(t))),
    ));
  }
  return out;
}

/**
 * Figures (open, late, today, done in 7 days) and the next three tasks by date.
 * @param {import('../index.js').AreaScope} scope
 * @returns {import('../index.js').HomeCard}
 */
export function homeCard({ ids }) {
  const today = todayKey();
  const all = tasksStore.current().tasks.filter((t) => inAreas(ids, t.domain));
  const open = all.filter((t) => t.status === 'open').sort(tasksLib.byDue);
  const late = open.filter((t) => t.due && t.due < today).length;
  const dueToday = open.filter((t) => t.due === today).length;
  const since = addDays(today, -7);
  const done = all.filter((t) => t.status === 'done' && closedOn(t) >= since).length;
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['open', open.length]];
  if (late) stats.push(['late', late, 'danger']);
  if (dueToday) stats.push(['today', dueToday, 'warn']);
  stats.push(['done 7d', done, 'ok']);
  const doms = domainsStore.current();
  const next = open.slice(0, 3).map((t) => {
    const d = t.due ? daysUntil(t.due, new Date(), tz()) : null;
    const when = d === null ? '' : d < 0 ? `${-d}d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : t.due;
    const sub = domainsLib.find(doms, domainsLib.canonical(doms, t.domain));
    return h(
      'li',
      { class: 'mini' },
      h('span', { class: 'mini-title' }, t.title),
      sub?.parent ? h('span', { class: 'chip muted' }, sub.name) : null,
      when ? h('span', { class: d !== null && d < 0 ? 'chip danger' : d === 0 ? 'chip warn' : 'chip' }, when) : null,
    );
  });
  return { stats, body: next.length ? [h('ul', { class: 'mini-list' }, ...next)] : [] };
}
