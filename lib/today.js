// @ts-check
// The "Today" view, shared by the app and the CLI: focus tasks first, then, grouped by domain, the
// tasks that are late or due in the next 7 days, the goals of the day and the week, deadlines within 7 days
// and the work in progress (`ongoing`). Tasks without a date only show up through focus or ongoing.

import { periodKey } from './period.js';
import * as goals from './goals.js';
import * as tasks from './tasks.js';
import * as domains from './domains.js';

/** @typedef {import('./goals.js').Goal} Goal */
/** @typedef {import('./tasks.js').Task} Task */

/**
 * @typedef {Object} TodayGroup
 * @property {string} domain     domain id, or the text as is when it is not registered
 * @property {string} label      "Parent › Child"
 * @property {boolean} inherited a parent of the scope: only what has a date
 * @property {Task[]} tasks      late, today and the next 7 days, by date
 * @property {Goal[]} goals
 * @property {Task[]} ongoing    work in progress not already listed above
 */

/**
 * @typedef {Object} TodayView
 * @property {string} date            YYYY-MM-DD
 * @property {string} week            YYYY-Www
 * @property {Task[]} focus
 * @property {number} focusElsewhere  focus tasks outside the scope
 * @property {number} liveGoals       all active goals (in every domain)
 * @property {TodayGroup[]} groups    non-empty ones: the scope's own first, its parents last
 */

/**
 * @param {Object} input
 * @param {import('./goals.js').GoalsDoc} input.goals
 * @param {import('./tasks.js').TasksDoc} input.tasks
 * @param {import('./domains.js').DomainsDoc} input.domains
 * @param {Date} input.now
 * @param {string} input.tz
 * @param {string|null} [input.scope]  domain id: it, its subdomains and the dated items of its parents
 * @returns {TodayView}
 */
export function buildToday({ goals: goalsDoc, tasks: tasksDoc, domains: domainsDoc, now, tz, scope = null }) {
  const date = periodKey('day', now, tz);
  const sc = scope ? domains.scope(domainsDoc, scope) : null;
  /** @param {string} text */
  const key = (text) => domains.canonical(domainsDoc, text);
  /** @param {string} text @param {boolean} dated */
  const visible = (text, dated) => !sc || sc.own.has(key(text)) || (dated && sc.inherited.has(key(text)));

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
      g = { domain: k, label: k ? domains.label(domainsDoc, k) : '(no domain)', inherited: !!sc && !sc.own.has(k), tasks: [], goals: [], ongoing: [] };
      groups.set(k, g);
    }
    return g;
  };
  for (const t of ts.dated) {
    if (shown.has(t.id) || !visible(t.domain, true)) continue;
    group(t.domain).tasks.push(t);
    shown.add(t.id);
  }
  for (const g of gs.today) if (visible(g.category, true)) group(g.category).goals.push(g);
  for (const t of ts.ongoing) if (!shown.has(t.id) && visible(t.domain, false)) group(t.domain).ongoing.push(t);

  /** @param {TodayGroup} g */
  const rank = (g) => {
    const i = domainsDoc.domains.findIndex((d) => d.id === g.domain);
    return (g.inherited ? 1e6 : 0) + (i < 0 ? 1e5 : i);
  };
  const sorted = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  return { date, week: periodKey('week', now, tz), focus, focusElsewhere: ts.focus.length - focus.length, liveGoals: gs.live, groups: sorted };
}
