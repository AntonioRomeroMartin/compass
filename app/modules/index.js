// @ts-check
// The modules of the app. Each module shows its part of an area's page and of that area's card on Home.
// Tasks and goals belong to every area. Later modules (journal, books, trading…) will belong only to the areas
// that list them in domains.json, and their code will be loaded the first time it is needed.

import * as tasks from './tasks/view.js';
import * as goals from './goals/view.js';

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
 * @property {[string, number|string, ('warn'|'danger'|'ok')?][]} stats  label, value, tone
 * @property {HTMLElement[]} body
 */

/**
 * @typedef {Object} Module
 * @property {string} id
 * @property {string} title                         heading of its block in an area's page
 * @property {string} addLabel                      its "+" button there ("Task", "Goal")
 * @property {(area: string) => void} add           opens its sheet with that area chosen
 * @property {(scope: AreaScope) => HTMLElement[]} areaSections
 * @property {(scope: AreaScope) => HomeCard} homeCard
 */

/** @type {Module[]} */
export const MODULES = [
  { id: 'tasks', title: 'Tasks', addLabel: 'Task', add: (area) => tasks.openTaskForm(undefined, area), areaSections: tasks.areaSections, homeCard: tasks.homeCard },
  { id: 'goals', title: 'Goals', addLabel: 'Goal', add: (area) => goals.openGoalForm(undefined, area), areaSections: goals.areaSections, homeCard: goals.homeCard },
];

/** Modules of an area, in the order they are shown (for now, all of them). @param {string} _areaId */
export const modulesOf = (_areaId) => MODULES;
