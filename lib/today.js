// @ts-check
// The "Today" view, shared by the app and the CLI: focus tasks first, then, grouped by domain, the
// events and tasks that are late or due in the next 7 days, the goals of the day and the week, deadlines within
// 7 days and the work in progress (`ongoing`). Tasks without a date only show up through focus or ongoing.
// Scoped to a domain (the chat of its folder, `compass today --cwd`), its own part is shown in full: also the tasks
// dated later and those without a date, and every active goal; the rest of the scope is agenda only (domains.chatScope).

import { periodKey } from './period.js';
import * as goals from './goals.js';
import * as tasks from './tasks.js';
import * as domains from './domains.js';
import * as events from './events.js';

/** @typedef {import('./goals.js').Goal} Goal */
/** @typedef {import('./tasks.js').Task} Task */
/** @typedef {import('./events.js').Event} Event */

/**
 * @typedef {Object} TodayGroup
 * @property {string} domain     domain id, or the text as is when it is not registered
 * @property {string} label      "Parent › Child"
 * @property {boolean} agenda    outside the scope's own part: only what has a date
 * @property {Event[]} events    going on today or in the next 7 days, by start
 * @property {Task[]} tasks      late, today and the next 7 days, by date
 * @property {Goal[]} goals      of the day and the week and deadlines within 7 days; in the scope's own part, every active one
 * @property {Task[]} ongoing    work in progress not already listed above (no scope)
 * @property {Task[]} later      the scope's own part: dated after the next 7 days, by date
 * @property {Task[]} undated    the scope's own part: without a date
 */

/**
 * @typedef {Object} TodayView
 * @property {string} date            YYYY-MM-DD
 * @property {string} week            YYYY-Www
 * @property {Task[]} focus
 * @property {number} focusElsewhere  focus tasks outside the scope
 * @property {number} liveGoals       all active goals (in every domain)
 * @property {TodayGroup[]} groups    non-empty ones: the scope's own first, its agenda last
 */

/**
 * @param {Object} input
 * @param {import('./goals.js').GoalsDoc} input.goals
 * @param {import('./tasks.js').TasksDoc} input.tasks
 * @param {import('./domains.js').DomainsDoc} input.domains
 * @param {import('./events.js').EventsDoc} [input.events]
 * @param {Date} input.now
 * @param {string} input.tz
 * @param {string|null} [input.scope]  domain id: its own part in full, the rest of domains.chatScope as agenda
 * @param {boolean} [input.root]        the scope is seen from the root folder: every other domain is agenda
 * @returns {TodayView}
 */
export function buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: domainsDoc, events: eventsDoc = events.emptyDoc(), now, tz, scope = null, root = false }) {
  const date = periodKey('day', now, tz);
  const sc = scope ? domains.chatScope(domainsDoc, scope, root) : null;
  /** @param {string} text */
  const key = (text) => domains.canonical(domainsDoc, text);
  /** @param {string} text */
  const isOwn = (text) => !!sc && sc.own.has(key(text));
  /** @param {string} text @param {boolean} dated */
  const visible = (text, dated) => !sc || isOwn(text) || (dated && (sc.others || sc.agenda.has(key(text))));

  const ts = tasks.summary(tasksDoc, date);
  const gs = goals.summary(goalsDoc, now, tz);
  const focus = ts.focus.filter((t) => visible(t.domain, !!t.due));
  /** @type {Set<string>} */
  const shown = new Set(ts.focus.map((t) => t.id));

  /** @type {Map<string, TodayGroup>} */
  const groups = new Map();
  /** @param {string} text */
  const group = (text) => {
    const k = key(text);
    let g = groups.get(k);
    if (!g) {
      g = { domain: k, label: k ? domains.label(domainsDoc, k) : '(no domain)', agenda: !!sc && !sc.own.has(k), events: [], tasks: [], goals: [], ongoing: [], later: [], undated: [] };
      groups.set(k, g);
    }
    return g;
  };
  for (const e of events.upcoming(eventsDoc, date, 7)) if (visible(e.domain, true)) group(e.domain).events.push(e);
  for (const t of ts.dated) {
    if (shown.has(t.id) || !visible(t.domain, true)) continue;
    group(t.domain).tasks.push(t);
    shown.add(t.id);
  }
  for (const g of gs.today) if (visible(g.category, true) && !isOwn(g.category)) group(g.category).goals.push(g);
  if (sc) {
    // The own part in full: every active goal, and the open tasks not listed yet (dated later, then without a date).
    for (const g of goalsDoc.goals) if (isOwn(g.category) && !g.archived && !goals.isExpired(g, now, tz)) group(g.category).goals.push(g);
    // Plain steps of a task are listed under it, not on their own.
    const rest = tasksDoc.tasks.filter((t) => t.status === 'open' && !shown.has(t.id) && isOwn(t.domain) && !tasks.isStep(tasksDoc, t, key));
    for (const t of rest.filter((x) => x.due).sort((a, b) => /** @type {string} */ (a.due).localeCompare(/** @type {string} */ (b.due)))) group(t.domain).later.push(t);
    for (const t of rest.filter((x) => !x.due)) group(t.domain).undated.push(t);
  } else for (const t of ts.ongoing) if (!shown.has(t.id)) group(t.domain).ongoing.push(t);

  /** @param {TodayGroup} g */
  const rank = (g) => {
    const i = domainsDoc.domains.findIndex((d) => d.id === g.domain);
    return (g.agenda ? 1e6 : 0) + (i < 0 ? 1e5 : i);
  };
  const sorted = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  return { date, week: periodKey('week', now, tz), focus, focusElsewhere: ts.focus.length - focus.length, liveGoals: gs.live, groups: sorted };
}
