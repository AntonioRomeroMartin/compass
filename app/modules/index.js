// @ts-check
// The modules of the app. Each module shows its part of an area's page and of that area's card on Home.
// Tasks, goals and habits belong to every area. Other modules (books…) belong only to the areas that list them in
// domains.json ("modules") and to their sub-areas, which inherit them.

import * as tasks from './tasks/view.js';
import * as goals from './goals/view.js';
import * as habits from './habits/view.js';
import * as books from './books/view.js';
import * as domainsLib from '../../lib/domains.js';
import { domainsStore } from '../core/data.js';

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
 * @property {boolean} [own]                        only in the areas that list it (not tasks, goals, habits)
 * @property {string} title                         heading of its block in an area's page
 * @property {string} addLabel                      its "+" button there ("Task", "Goal", "Habit")
 * @property {(area: string) => void} add           opens its sheet with that area chosen
 * @property {(scope: AreaScope) => HTMLElement[]} areaSections
 * @property {(scope: AreaScope) => HomeCard} homeCard
 */

/** @type {Module[]} */
export const MODULES = [
  { id: 'tasks', title: 'Tasks', addLabel: 'Task', add: (area) => tasks.openTaskForm(undefined, area), areaSections: tasks.areaSections, homeCard: tasks.homeCard },
  { id: 'goals', title: 'Goals', addLabel: 'Goal', add: (area) => goals.openGoalForm(undefined, area), areaSections: goals.areaSections, homeCard: goals.homeCard },
  { id: 'habits', title: 'Habits', addLabel: 'Habit', add: (area) => habits.openHabitForm(undefined, area), areaSections: habits.areaSections, homeCard: habits.homeCard },
  { id: 'books', own: true, title: 'Books', addLabel: 'Book', add: (area) => books.openBookForm(area), areaSections: books.areaSections, homeCard: books.homeCard },
];

/** Modules of an area, in the order they are shown: tasks, goals and habits, then those it lists. @param {string} areaId */
export function modulesOf(areaId) {
  const listed = domainsLib.modulesOf(domainsStore.current(), areaId);
  return MODULES.filter((m) => !m.own || listed.includes(m.id));
}

/** Areas that list a module (directly, not their sub-areas). @param {string} module */
export const areasWith = (module) => domainsStore.current().domains.filter((d) => d.modules?.includes(module));
