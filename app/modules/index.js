// @ts-check
// The modules of the app. Each module shows its part of an area's page and of that area's card on Home.
// Tasks, goals and habits show in every area, even empty. Other modules (events, sources, finance, trades) show only in the
// areas that have something of theirs (their `shownIn`).

import * as tasks from './tasks/view.js';
import * as goals from './goals/view.js';
import * as habits from './habits/view.js';
import * as sources from './sources/view.js';
import * as events from './events/view.js';
import * as trades from './trades/view.js';
import * as finance from './finance/view.js';
import { areaIds } from '../core/data.js';

/**
 * What a module is asked to show: one area (or the sub-area chosen in its page) and everything below it.
 * @typedef {Object} AreaScope
 * @property {string} id
 * @property {Set<string>} ids  the area and its sub-areas
 * @property {boolean} showSub  say on each row which sub-area it belongs to
 */

/**
 * A module's part of an area card on Home: a few figures and a few lines.
 * @typedef {Object} HomeCard
 * @property {[string, number|string, ('warn'|'danger')?][]} stats  label, value, tone
 * @property {HTMLElement[]} body
 */

/**
 * @typedef {Object} Module
 * @property {string} id
 * @property {(ids: Set<string>) => boolean} [shownIn]  only in the areas where this is true (has items there)
 * @property {string} title                         heading of its block in an area's page
 * @property {string} [addLabel]                    its "+" button there ("Task", "Goal", "Habit"); none for what is imported
 * @property {(area: string) => void} [add]         opens its sheet with that area chosen
 * @property {() => HTMLElement|null} [banner]      a warning on top of Home (a risk limit hit)
 * @property {(scope: AreaScope) => HTMLElement[]} areaSections
 * @property {(scope: AreaScope) => HomeCard} homeCard
 */

/** @type {Module[]} */
export const MODULES = [
  { id: 'tasks', title: 'Tasks', addLabel: 'Task', add: (area) => tasks.openTaskForm(undefined, area), areaSections: tasks.areaSections, homeCard: tasks.homeCard },
  { id: 'goals', title: 'Goals', addLabel: 'Goal', add: (area) => goals.openGoalForm(undefined, area), areaSections: goals.areaSections, homeCard: goals.homeCard },
  { id: 'habits', title: 'Habits', addLabel: 'Habit', add: (area) => habits.openHabitForm(undefined, area), areaSections: habits.areaSections, homeCard: habits.homeCard },
  { id: 'events', shownIn: events.hasEvents, title: 'Events', addLabel: 'Event', add: (area) => events.openEventForm(area), areaSections: events.areaSections, homeCard: events.homeCard },
  { id: 'sources', shownIn: sources.hasSources, title: 'Sources', addLabel: 'Source', add: (area) => sources.openSourceForm(area), areaSections: sources.areaSections, homeCard: sources.homeCard },
  { id: 'finance', shownIn: finance.hasFinance, title: 'Finance', areaSections: finance.areaSections, homeCard: finance.homeCard },
  { id: 'trades', shownIn: trades.hasTrades, title: 'Trades', areaSections: trades.areaSections, homeCard: trades.homeCard, banner: trades.limitBanner },
];

/** Modules of an area, in the order they are shown: tasks, goals and habits, then those with items there. @param {string} areaId */
export function modulesOf(areaId) {
  const ids = areaIds(areaId);
  return MODULES.filter((m) => !m.shownIn || m.shownIn(ids));
}
