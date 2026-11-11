// @ts-check
// Tasks module (app side): task rows, the task sheet, and its parts of the area page and the Home card.
import * as tasksLib from '../../../lib/tasks.js';
import * as domainsLib from '../../../lib/domains.js';
import { canEdit, domainsStore, inAreas, tasksStore, todayKey, tz } from '../../core/data.js';
import { $, areaPicker, chipPicker, editRow, h } from '../../core/ui.js';
import { newId } from '../../../lib/goals.js';
import { addDays, daysUntil, endOfWeek, periodKey } from '../../../lib/period.js';

/** @typedef {import('../../../lib/tasks.js').Task} Task */

/** Canonical id of a domain, for telling a plain step from a subtask in another area. @param {string} d */
const canon = (d) => domainsLib.canonical(domainsStore.current(), d);

/** Is it a plain step of an open task (listed under it, not on its own)? @param {Task} t */
export const isStep = (t) => tasksLib.isStep(tasksStore.current(), t, canon);

/**
 * Asks before closing a task that has open ones under it: they are closed with it.
 * @param {Task} t @param {string} verb "Completing" or "Dropping"
 */
function closesAlong(t, verb) {
  const along = tasksLib.descendants(tasksStore.current(), t.id).filter((x) => x.status === 'open');
  return !along.length || confirm(`${verb} it also closes: ${along.map((x) => x.title).join(', ')}.\n\nReopening it brings them back.`);
}

/** @param {Task} t @returns {boolean} whether it was changed */
export function toggleTask(t) {
  if (!canEdit()) return false;
  const now = new Date();
  if (t.status === 'open') {
    if (!closesAlong(t, 'Completing')) return false;
    tasksStore.dispatch([{ type: 'done', id: t.id, at: now.toISOString(), today: todayKey(), nextId: t.repeat ? newId('t_') : null }]);
  } else {
    tasksStore.dispatch([{ type: 'reopen', id: t.id }]);
  }
  return true;
}

/** @param {Task} t @param {boolean} [showArea] @param {boolean} [short] area chip with the sub-area's name only (inside its parent's page) */
export function taskRow(t, showArea = false, short = false) {
  const doms = domainsStore.current();
  const d = t.due ? daysUntil(t.due, new Date(), tz()) : null;
  const when = d === null ? null : d < 0 ? `${-d}d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : t.due;
  const done = t.status !== 'open';
  const steps = tasksLib.progress(tasksStore.current(), t);
  const parent = isStep(t) ? undefined : tasksLib.parentOf(tasksStore.current(), t);
  return h(
    'li',
    { class: done ? 'task done' : 'task' },
    h('input', { type: 'checkbox', checked: done, disabled: !canEdit(), 'aria-label': `Done: ${t.title}`, onchange: (/** @type {Event} */ ev) => { if (!toggleTask(t)) /** @type {HTMLInputElement} */ (ev.target).checked = done; } }),
    h('button', { class: 'task-title', disabled: !canEdit(), onclick: () => openTaskForm(t) }, t.title),
    h(
      'span',
      { class: 'task-meta' },
      steps.total ? h('span', { class: 'chip muted' }, `${steps.done}/${steps.total}`) : null,
      parent ? h('span', { class: 'chip muted', title: `Part of ${parent.title}` }, `↳ ${parent.title}`) : null,
      showArea ? h('span', { class: 'chip muted' }, (short ? domainsLib.find(doms, domainsLib.canonical(doms, t.domain))?.name : domainsLib.label(doms, domainsLib.canonical(doms, t.domain))) || t.domain) : null,
      when ? h('span', { class: d !== null && d < 0 ? 'chip danger' : d === 0 ? 'chip warn' : 'chip' }, when) : null,
      t.repeat ? h('span', { class: 'chip muted', title: tasksLib.repeatText(t.repeat) }, '↻') : null,
    ),
  );
}

/**
 * A task's row followed by the rows of its plain steps (and theirs), indented; dropped steps are left out.
 * @param {Task} t @param {boolean} [showArea] @param {boolean} [short] @param {number} [depth]
 * @returns {HTMLElement[]}
 */
export function taskRows(t, showArea = false, short = false, depth = 0) {
  const row = taskRow(t, showArea, short);
  if (depth) row.style.paddingLeft = `${12 + depth * 28}px`;
  const steps = t.status === 'open' ? tasksLib.children(tasksStore.current(), t.id).filter((c) => c.status !== 'dropped' && isStep(c)) : [];
  return [row, ...steps.flatMap((c) => taskRows(c, false, short, depth + 1))];
}

/**
 * Fills the read-only list of a task's chats (nested by who opened whom) and shows or hides its box.
 * @param {HTMLElement} list @param {Task} [task]
 */
function chatTree(list, task) {
  /** @param {ReturnType<typeof tasksLib.chatTree>} nodes @returns {HTMLElement[]} */
  const items = (nodes) => nodes.map(({ chat, children }) => {
    return h('li', {}, h('span', {}, chat.title || 'Untitled chat'),
      children.length ? h('ul', { class: 'chat-tree' }, ...items(children)) : null);
  });
  list.replaceChildren(...(task ? items(tasksLib.chatTree(task)) : []));
  /** @type {HTMLElement} */ (list.parentElement).hidden = !list.children.length;
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

  const parent = task ? tasksLib.parentOf(tasksStore.current(), task) : undefined;
  $('task-dialog-title').textContent = !task ? 'New task' : parent ? `Edit task · part of ${parent.title}` : 'Edit task';
  // Its subtasks are tasks of their own: here only their titles are edited (dropped ones are left alone).
  const parts = task ? tasksLib.children(tasksStore.current(), task.id).filter((c) => c.status !== 'dropped') : [];
  /** @type {HTMLElement} */ (dialog.querySelector('.kind-switch')).hidden = !!task;
  $('task-submit').textContent = task ? 'Save' : 'Add';
  f.title.value = task?.title ?? '';

  let area = task ? domainsLib.canonical(doms, task.domain) || task.domain : domain ?? '';
  areaPicker($('task-areas'), doms, area, (v) => { area = v; });

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
  f.location.value = task?.location ?? '';
  const subList = $('subtask-list');
  subList.replaceChildren(...parts.map((st) => editRow(st.id, st.title, 'Step', 'add-subtask')));
  $('add-subtask').onclick = () => {
    const row = editRow('', '', 'Step', 'add-subtask');
    subList.append(row);
    /** @type {HTMLInputElement} */ (row.querySelector('input')).focus();
  };
  chatTree($('task-chat-list'), task);
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
        if (!closesAlong(task, 'Dropping')) return;
        const stop = !!task.repeat && confirm('Stop repeating it too?\n\nOK: no more copies. Cancel: drop only this one.');
        tasksStore.dispatch([{ type: 'drop', id: task.id, at: new Date().toISOString(), today, nextId: task.repeat && !stop ? newId('t_') : null }]);
        dialog.close();
      } }, 'Drop'));
    } else {
      extra.append(h('button', { type: 'button', class: 'btn', onclick: () => { tasksStore.dispatch([{ type: 'reopen', id: task.id }]); dialog.close(); } }, 'Reopen'));
    }
    extra.append(h('button', { type: 'button', class: 'link danger', onclick: () => {
      const under = tasksLib.descendants(tasksStore.current(), task.id).length;
      if (!confirm(`Delete “${task.title}”${under ? ` and the ${under} under it` : ''} permanently?\n\nTo keep a record, use “Drop”.`)) return;
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
      location: String(f.location.value).trim() || null,
    };
    const rows = Array.from(subList.querySelectorAll('li'), (li) => ({
      id: li.dataset.id ?? '',
      title: /** @type {HTMLInputElement} */ (li.querySelector('input')).value.trim(),
    })).filter((x) => x.title);
    /** @param {string} parentId @param {string} t */
    const step = (parentId, t) => /** @type {const} */ ({ type: 'add', task: tasksLib.newTask({ title: t, domain: area, parent: parentId }) });
    if (task) {
      const gone = parts.filter((x) => !rows.some((r) => r.id === x.id));
      // A subtask with more to it than a title (a date, another area, chats, its own subtasks) is not deleted lightly.
      const more = gone.filter((x) => !isStep(x) || x.sessions?.length || tasksLib.children(tasksStore.current(), x.id).length);
      if (more.length && !confirm(`Delete ${more.map((x) => `“${x.title}”`).join(', ')} permanently, with what is under?`)) return;
      /** @type {import('../../../lib/tasks.js').Op[]} */
      const ops = [
        { type: 'edit', id: task.id, fields },
        ...gone.map((x) => /** @type {const} */ ({ type: 'delete', id: x.id })),
        ...rows.flatMap((r) => {
          const prev = parts.find((x) => x.id === r.id);
          if (!prev) return [step(task.id, r.title)];
          return prev.title === r.title ? [] : [/** @type {const} */ ({ type: 'edit', id: prev.id, fields: { title: r.title } })];
        }),
      ];
      tasksStore.dispatch(ops);
    } else {
      const t = tasksLib.newTask(fields);
      tasksStore.dispatch([{ type: 'add', task: t }, ...rows.map((r) => step(t.id, r.title))]);
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
  const open = all.filter((t) => t.status === 'open' && !isStep(t)).sort(tasksLib.byDue);
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
    out.push(h('section', { class: 'group sub-group' }, h('h3', {}, title, h('span', { class: 'sub' }, String(list.length))),
      h('ul', { class: 'rows' }, ...list.flatMap((t) => taskRows(t, showSub && domainsLib.canonical(doms, t.domain) !== id, true)))));
  }
  if (!open.length) out.push(h('p', { class: 'empty small' }, 'No open tasks here.'));
  if (recent.length) {
    out.push(h(
      'details',
      { class: 'group sub-group undated' },
      h('summary', {}, h('h3', {}, 'Done in the last 7 days', h('span', { class: 'sub' }, String(recent.length)))),
      h('ul', { class: 'rows' }, ...recent.map((t) => taskRow(t))),
    ));
  }
  return out;
}

/**
 * Figures (open, late, today) and the next three tasks by date.
 * @param {import('../index.js').AreaScope} scope
 * @returns {import('../index.js').HomeCard}
 */
export function homeCard({ ids }) {
  const today = todayKey();
  const open = tasksStore.current().tasks.filter((t) => t.status === 'open' && inAreas(ids, t.domain) && !isStep(t)).sort(tasksLib.byDue);
  const late = open.filter((t) => t.due && t.due < today).length;
  const dueToday = open.filter((t) => t.due === today).length;
  /** @type {import('../index.js').HomeCard['stats']} */
  const stats = [['open', open.length]];
  if (late) stats.push(['late', late, 'danger']);
  if (dueToday) stats.push(['today', dueToday, 'warn']);
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
