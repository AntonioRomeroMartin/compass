#!/usr/bin/env node
// @ts-check
// compass CLI: for scripts and agents (and anyone else) to read and change the data without editing
// the JSON by hand. Shares its logic with the app (`lib/`) and writes with operations, like the app.

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { HORIZONS, daysUntil, deviceTimeZone, isValidTimeZone, periodKey, periodKeys } from '../lib/period.js';
import { applyOps, commitMessage, emptyDoc, goalKey, isDone, isExpired, newId, normalize, serialize, subgoalsDone } from '../lib/goals.js';
import * as tasks from '../lib/tasks.js';
import * as domains from '../lib/domains.js';
import { buildToday } from '../lib/today.js';
import { NET_TIMEOUT, commitChange, commitFiles, loadConfig, pull, readJson, readJsonIfExists } from './repo.mjs';

/** @typedef {import('../lib/goals.js').Goal} Goal */
/** @typedef {import('../lib/goals.js').GoalsDoc} GoalsDoc */
/** @typedef {import('../lib/goals.js').Op} Op */
/** @typedef {import('../lib/period.js').Horizon} Horizon */
/** @typedef {import('../lib/tasks.js').Task} Task */
/** @typedef {import('../lib/tasks.js').TasksDoc} TasksDoc */
/** @typedef {import('../lib/domains.js').DomainsDoc} DomainsDoc */
/** @typedef {import('./repo.mjs').Config} Config */

/**
 * What every command works with.
 * @typedef {Object} Ctx
 * @property {Config} cfg
 * @property {Date} now
 * @property {string} tz      zone of tasks.json (or goals.json): civil dates of tasks
 * @property {string} gtz     zone of goals.json (or tasks.json): period keys of goals
 * @property {string} today   YYYY-MM-DD in `tz`
 * @property {GoalsDoc} goals
 * @property {TasksDoc} tasks
 * @property {DomainsDoc} domains
 * @property {boolean} sync
 */

const HELP = `compass — goals, tasks and domains from the command line

Usage:
  compass today [--domain D | --cwd PATH] [--timeout S]
                                        focus, then by domain: tasks late/today/this week, goals
                                        of the day and week, deadlines within 7 days, ongoing work
  compass tasks [--domain D | --cwd PATH] [--due today|week|overdue] [--all]
  compass task add "title" (--domain D | --cwd PATH) [--due DATE] [--repeat RULE] [--goal G]
                   [--ongoing PATH] [--notes T] [--focus]
  compass task done|undo|drop|focus|unfocus|show <task>
  compass task delete <task> --yes      for good (drop keeps a record)
  compass task drop <task> --stop       a repeating task: no next occurrence
  compass task move <task> [DATE]       default: tomorrow
  compass task edit <task> [--title T] [--domain D] [--due DATE] [--repeat RULE] [--goal G]
                   [--ongoing PATH] [--notes T]          (none clears a field)
  compass task sub <task> <subtask> [--undo] | --add T | --remove <subtask>
  compass domains
  compass domain add <id> [--name N] [--parent P] [--path DIR] [--color C]
  compass domain edit <id> [--name N] [--color C|none] [--add-path DIR] [--remove-path DIR]
  compass goals [--past|--archived|--all] [--category C]
  compass goal add --title T --category C --horizon day|week|month|quarter|year|deadline
                   [--target N] [--unit U] [--deadline YYYY-MM-DD] [--repeat]
                   [--notes T] [--location T] [--repo R]
  compass goal inc <goal> [delta]       add to the current period (default 1)
  compass goal set <goal> <value>
  compass goal done <goal>              set to its target (or 1 without target)
  compass goal sub <goal> <sub-goal> [--undo]
  compass goal edit <goal> [--title T] [--category C] [--target N] [--unit U] [--notes T] [--location T]
  compass goal archive|unarchive <goal>
  compass period [YYYY-MM-DD] [--tz Area/City] [--days YYYY-MM-DD]

<task>, <goal>: an id (t_…, g_…) or part of the title. D: a domain id or name. --cwd: the domain whose
"paths" contain that folder (a subdomain also sees the dated items of its parents).
DATE: YYYY-MM-DD, today, tomorrow, +N, mon…sun, none. RULE: daily, every N days, weekly, mon,thu,
weekdays, monthly, monthly:15, none. A done task with --goal adds 1 to that goal.
--no-sync skips git pull/push; --timeout S limits the pull (default 3 s for today, 20 s otherwise).
Config: ~/.config/compass/config.json →
  {"repo": "<data repo checkout>", "goals": "goals.json", "tasks": "tasks.json", "domains": "domains.json"}`;

/** Flags that never take a value. */
const BOOLEAN = new Set(['all', 'past', 'archived', 'undo', 'focus', 'stop', 'no-sync', 'help', 'yes']);

/** @param {string[]} argv */
function parse(argv) {
  /** @type {string[]} */
  const pos = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN.has(name) && next !== undefined && !next.startsWith('--')) flags[name] = argv[++i];
      else flags[name] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/** @param {string | true | undefined} v */
const str = (v) => (typeof v === 'string' ? v : undefined);

/**
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/**
 * Runs a parser from lib/ and turns its error into a CLI error.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** @param {number} n */
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** @param {number} d  days from today */
const relDays = (d) => (d < 0 ? `${-d} d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} d`);

/** @param {string | undefined} v  "none" (and friends) clears a field */
const orNull = (v) => (v === undefined || ['', 'none', 'no'].includes(v.trim().toLowerCase()) ? null : v);

/**
 * One compact line per goal (easy for scripts and agents to read).
 * @param {Goal} g @param {Date} now @param {string} tz
 */
function goalLine(g, now, tz) {
  const key = goalKey(g, now, tz);
  const value = g.progress[key] ?? 0;
  const done = isDone(g, key);
  const progress = g.target ? `${fmt(value)}/${fmt(g.target)}${g.unit ? ` ${g.unit}` : ''}` : done ? 'done' : 'not done';
  const when = g.horizon === 'deadline'
    ? `due ${g.deadline} (${relDays(daysUntil(/** @type {string} */ (g.deadline), now, tz))})`
    : `${g.horizon}${g.repeat ? ' · habit' : ''}`;
  const bits = [progress, when, g.category];
  if (g.subgoals?.length) bits.push(`sub ${subgoalsDone(g, key)}/${g.subgoals.length}`);
  if (g.location) bits.push(`@ ${g.location}`);
  return `${done ? '✓' : '·'} [${g.id}] ${g.title} — ${bits.join(' · ')}`;
}

/**
 * One compact line per task. ⭐ focus, ✓ done, ✗ dropped.
 * @param {Task} t @param {Ctx} ctx @param {{ domain?: boolean }} [opts]
 */
function taskLine(t, ctx, opts = {}) {
  const mark = t.status === 'done' ? '✓' : t.status === 'dropped' ? '✗' : t.focus ? '⭐' : '·';
  const bits = [];
  if (t.due) bits.push(t.status === 'open' ? `due ${t.due} (${relDays(daysUntil(t.due, ctx.today, 'UTC'))})` : `due ${t.due}`);
  if (opts.domain !== false) bits.push(t.domain);
  if (t.repeat) bits.push(`↻ ${tasks.repeatText(t.repeat)}`);
  if (t.subtasks.length) bits.push(`sub ${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`);
  if (t.goal) bits.push(`+1 goal “${ctx.goals.goals.find((g) => g.id === t.goal)?.title ?? t.goal}”`);
  if (t.ongoing) bits.push(`ongoing ${t.ongoing}`);
  if (t.notes) bits.push('notes');
  if (t.status !== 'open' && t.doneAt) bits.push(`${t.status} ${periodKey('day', new Date(t.doneAt), ctx.tz)}`);
  return `${mark} [${t.id}] ${t.title}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
}

/**
 * @param {GoalsDoc} doc @param {string | undefined} ref
 * @returns {Goal}
 */
function findGoal(doc, ref) {
  if (!ref) fail('which goal? (id or part of the title)');
  const byId = doc.goals.find((g) => g.id === ref);
  if (byId) return byId;
  const q = ref.toLowerCase();
  const live = doc.goals.filter((g) => !g.archived && g.title.toLowerCase().includes(q));
  const pool = live.length ? live : doc.goals.filter((g) => g.title.toLowerCase().includes(q));
  if (pool.length === 1) return pool[0];
  if (!pool.length) fail(`no goal matches “${ref}”`);
  return fail(`“${ref}” matches several goals:\n${pool.map((g) => `  [${g.id}] ${g.title}`).join('\n')}`);
}

/**
 * A task by id or part of the title. Open tasks are preferred (closed ones for `undo`); among
 * copies of the same repeating task, the next open one (or the last closed one) is picked.
 * @param {TasksDoc} doc @param {string | undefined} ref @param {boolean} [closed]
 * @returns {Task}
 */
function findTask(doc, ref, closed = false) {
  if (!ref) fail('which task? (id or part of the title)');
  const byId = doc.tasks.find((t) => t.id === ref);
  if (byId) return byId;
  const q = ref.toLowerCase();
  const all = doc.tasks.filter((t) => t.title.toLowerCase().includes(q));
  const preferred = all.filter((t) => (t.status === 'open') !== closed);
  const pool = preferred.length ? preferred : all;
  if (!pool.length) fail(`no task matches “${ref}”`);
  if (pool.length === 1) return pool[0];
  if (pool.every((t) => t.title === pool[0].title)) {
    return closed ? pool.reduce((a, b) => ((b.doneAt ?? '') > (a.doneAt ?? '') ? b : a)) : [...pool].sort(tasks.byDue)[0];
  }
  return fail(`“${ref}” matches several tasks:\n${pool.slice(0, 10).map((t) => `  [${t.id}] ${t.title}`).join('\n')}`);
}

/**
 * Domain id from a reference (id, name or last segment). Without a registry, any text is accepted.
 * @param {Ctx} ctx @param {string} ref
 */
function domainRef(ctx, ref) {
  if (!ctx.domains.domains.length) {
    if (!domains.isValidId(ref)) fail(`invalid domain “${ref}” (no spaces; "/" separates subdomains)`);
    console.error(`note: no domains registered yet (${ctx.cfg.domains}); using “${ref}” as is`);
    return ref;
  }
  const matches = domains.lookup(ctx.domains, ref);
  if (matches.length === 1) return matches[0].id;
  if (!matches.length) fail(`unknown domain “${ref}” (see compass domains)`);
  return fail(`“${ref}” matches several domains: ${matches.map((d) => d.id).join(', ')}`);
}

/**
 * The domain of --domain, or the one whose paths contain --cwd.
 * @param {Ctx} ctx @param {Record<string, string | true>} flags
 * @returns {{ id: string | null, note: string | null }}
 */
function scopeFrom(ctx, flags) {
  const ref = str(flags.domain);
  if (ref) return { id: domainRef(ctx, ref), note: null };
  const cwd = str(flags.cwd);
  if (!cwd) return { id: null, note: null };
  const d = domains.resolvePath(ctx.domains, resolve(cwd), homedir());
  return d ? { id: d.id, note: 'from --cwd' } : { id: null, note: 'no domain has a path containing --cwd' };
}

/** @param {string} raw @param {string} what */
function positive(raw, what) {
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) fail(`${what} must be a number greater than 0`);
  return n;
}

/** @param {...(string | undefined)} zones */
function pickZone(...zones) {
  const tz = zones.find((z) => isValidTimeZone(z));
  if (tz) return tz;
  const device = deviceTimeZone();
  console.error(`warning: no valid "timeZone" in the data files; using this device's (${device})`);
  return device;
}

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, sub, ...rest] = pos;
  if (!cmd || cmd === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  const sync = !flags['no-sync'];
  const cfg = loadConfig();
  const now = new Date();

  if (cmd === 'period') {
    let tz = str(flags.tz);
    if (!tz) tz = readJsonIfExists(cfg, cfg.goals)?.timeZone ?? readJsonIfExists(cfg, cfg.tasks)?.timeZone;
    if (!isValidTimeZone(tz)) fail('no valid time zone: use --tz Area/City or set "timeZone" in goals.json');
    const when = sub ?? now;
    const until = str(flags.days) ?? str(flags.dias);
    if (until) console.log(daysUntil(until, when, tz));
    else console.log(JSON.stringify({ timeZone: tz, ...periodKeys(when, tz) }, null, 2));
    return;
  }

  if (sync) {
    const seconds = str(flags.timeout) === undefined ? null : Number(str(flags.timeout));
    if (seconds !== null && !(seconds > 0)) fail('--timeout must be a number of seconds greater than 0');
    pull(cfg, seconds ? seconds * 1000 : cmd === 'today' ? 3000 : NET_TIMEOUT);
  }
  const rawGoals = readJsonIfExists(cfg, cfg.goals);
  const rawTasks = readJsonIfExists(cfg, cfg.tasks);
  /** @type {GoalsDoc} */
  const goalsDoc = normalize(rawGoals ?? emptyDoc());
  const tasksDoc = tasks.normalize(rawTasks ?? tasks.emptyDoc());
  const tz = pickZone(tasksDoc.timeZone, goalsDoc.timeZone);
  /** @type {Ctx} */
  const ctx = {
    cfg, now, sync, tz, gtz: isValidTimeZone(goalsDoc.timeZone) ? goalsDoc.timeZone : tz, today: periodKey('day', now, tz),
    goals: goalsDoc, tasks: tasksDoc, domains: domains.normalize(readJsonIfExists(cfg, cfg.domains) ?? domains.emptyDoc()),
  };

  switch (cmd) {
    case 'today': return today(ctx, flags);
    case 'tasks': return listTasks(ctx, flags);
    case 'task': return task(ctx, sub, rest, flags);
    case 'domains': return listDomains(ctx);
    case 'domain': return domain(ctx, sub, rest, flags);
    case 'goals': return listGoals(ctx, flags);
    case 'goal': return goal(ctx, sub, rest, flags);
    default: fail(`unknown command “${cmd}” (compass help)`);
  }
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function today(ctx, flags) {
  const scope = scopeFrom(ctx, flags);
  const view = buildToday({ goals: ctx.goals, tasks: ctx.tasks, domains: ctx.domains, now: ctx.now, tz: ctx.tz, scope: scope.id });
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: ctx.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ctx.now);
  console.log(`Today · ${date} · ${view.date} · ${view.week} (${ctx.tz})`);
  if (scope.id) {
    const parents = domains.ancestors(ctx.domains, scope.id).map((id) => domains.label(ctx.domains, id));
    const what = `${domains.label(ctx.domains, scope.id)} [${scope.id}]${parents.length ? ` + dated items of ${parents.join(', ')}` : ''}`;
    console.log(`Scope: ${what}${scope.note ? ` (${scope.note})` : ''}`);
  } else if (scope.note) console.log(`Scope: everything (${scope.note})`);
  if (view.focus.length || view.focusElsewhere) {
    console.log('Focus');
    for (const t of view.focus) console.log(`  ${taskLine(t, ctx)}`);
    if (view.focusElsewhere) console.log(`  (+${view.focusElsewhere} in other domains)`);
  }
  if (!view.groups.length) console.log('Nothing due this week.');
  for (const g of view.groups) {
    const id = g.domain && g.label !== g.domain ? ` [${g.domain}]` : '';
    console.log(`${g.label}${id}${g.inherited ? ' · parent, dated only' : ''}`);
    for (const t of g.tasks) console.log(`  ${taskLine(t, ctx, { domain: false })}`);
    for (const goal of g.goals) console.log(`  ${goalLine(goal, ctx.now, ctx.gtz)}`);
    for (const t of g.ongoing) console.log(`  ↳ ongoing [${t.id}] ${t.title} → ${t.ongoing}`);
  }
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function listTasks(ctx, flags) {
  const scope = scopeFrom(ctx, flags);
  if (scope.note && !scope.id) console.error(`note: ${scope.note}; listing every domain`);
  const own = scope.id ? domains.scope(ctx.domains, scope.id).own : null;
  const due = str(flags.due);
  if (due && !['today', 'week', 'overdue'].includes(due)) fail('--due must be today, week or overdue');
  const list = ctx.tasks.tasks
    .filter((t) => (flags.all || t.status === 'open')
      && (!own || own.has(domains.canonical(ctx.domains, t.domain)))
      && (!due || (t.status === 'open' && tasks.isDueWithin(t, /** @type {'today'|'week'|'overdue'} */ (due), ctx.today))))
    .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || tasks.byDue(a, b));
  if (!list.length) console.log('No tasks.');
  for (const t of list) console.log(taskLine(t, ctx));
}

/**
 * A change to tasks.json, plus goals.json when a linked goal gets (or loses) progress:
 * both go in one commit.
 * @typedef {{ tasks: import('../lib/tasks.js').Op[], goals?: Op[] }} Plan
 */

/**
 * Writes a plan built on the freshest versions of the files (and builds it again if the push
 * has to be retried).
 * @param {Ctx} ctx @param {(t: TasksDoc, g: GoalsDoc | null) => Plan} build
 */
function writeTasks(ctx, build) {
  const { cfg } = ctx;
  return commitFiles(cfg, [cfg.tasks, cfg.goals], (docs) => {
    const tBefore = docs[cfg.tasks] ? tasks.normalize(docs[cfg.tasks]) : tasks.emptyDoc(ctx.tz);
    const gBefore = docs[cfg.goals] ? normalize(docs[cfg.goals]) : null;
    const plan = build(tBefore, gBefore);
    /** @type {Record<string, string>} */
    const files = {};
    const messages = [];
    if (plan.tasks.length) {
      const after = tasks.applyOps(tBefore, plan.tasks);
      files[cfg.tasks] = tasks.serialize(after);
      messages.push(tasks.commitMessage(plan.tasks, tBefore, after));
    }
    if (plan.goals?.length && gBefore) {
      const after = applyOps(gBefore, plan.goals);
      files[cfg.goals] = serialize(after);
      messages.push(commitMessage(plan.goals, gBefore, after));
    }
    return messages.length ? { files, message: messages.join('\n\n') } : null;
  }, { sync: ctx.sync });
}

/**
 * +delta on a linked goal, in its current period (nothing if it is gone, archived or expired).
 * @param {Ctx} ctx @param {GoalsDoc | null} doc @param {string | null} id @param {number} delta
 * @returns {Op[]}
 */
function goalCredit(ctx, doc, id, delta) {
  if (!id) return [];
  const g = doc?.goals.find((x) => x.id === id);
  if (!g || g.archived || isExpired(g, ctx.now, ctx.gtz)) {
    console.error(`note: the linked goal ${id} is not active; its progress is not changed`);
    return [];
  }
  return [{ type: 'inc', id, key: goalKey(g, ctx.now, ctx.gtz), delta }];
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function task(ctx, sub, rest, flags) {
  const at = ctx.now.toISOString();
  /** @param {string} text */
  const date = (text) => attempt(() => tasks.parseDue(text, ctx.today));
  /** @param {string} text @param {string} anchor */
  const rule = (text, anchor) => attempt(() => tasks.parseRepeat(text, anchor));
  /** @param {string | true | undefined} ref */
  const goalId = (ref) => (str(ref) === undefined || orNull(str(ref)) === null ? null : findGoal(ctx.goals, str(ref)).id);
  /** @type {string | null} */
  let id = null;
  /** @type {(t: TasksDoc, g: GoalsDoc | null) => Plan} */
  let build;

  if (sub === 'add') {
    const title = rest[0] ?? str(flags.title);
    if (!title) fail('task add needs a title: compass task add "title" --domain D');
    const scope = scopeFrom(ctx, flags);
    if (!scope.id) fail(scope.note ? `${scope.note}; use --domain` : 'a task needs a domain: --domain D (or --cwd PATH)');
    const due = str(flags.due) !== undefined ? date(/** @type {string} */ (str(flags.due))) : null;
    const repeat = str(flags.repeat) ? rule(/** @type {string} */ (str(flags.repeat)), due ?? ctx.today) : null;
    const t = tasks.newTask({
      title, domain: /** @type {string} */ (scope.id), due: repeat && !due ? tasks.firstDue(repeat, ctx.today) : due,
      repeat, goal: goalId(flags.goal), ongoing: orNull(str(flags.ongoing)), notes: orNull(str(flags.notes)),
    }, ctx.now);
    id = t.id;
    build = (fresh) => {
      if (flags.focus && !tasks.canFocus(fresh, t.id)) focusFull(fresh);
      return { tasks: [{ type: 'add', task: t }, ...(flags.focus ? [{ type: /** @type {const} */ ('focus'), id: t.id, focus: true }] : [])] };
    };
  } else {
    const t = findTask(ctx.tasks, rest[0], sub === 'undo' || sub === 'delete');
    const tid = t.id;
    id = tid;
    /** @param {TasksDoc} fresh */
    const live = (fresh) => fresh.tasks.find((x) => x.id === tid) ?? fail('the task no longer exists');
    switch (sub) {
      case 'show':
        return showTask(t, ctx);
      case 'done':
        build = (fresh, goals) => {
          const cur = live(fresh);
          if (cur.status !== 'open') return { tasks: [] };
          return {
            tasks: [{ type: 'done', id: tid, at, today: ctx.today, nextId: cur.repeat ? newId('t_') : null }],
            goals: goalCredit(ctx, goals, cur.goal, 1),
          };
        };
        break;
      case 'drop':
        build = (fresh) => {
          const cur = live(fresh);
          if (cur.status !== 'open') return { tasks: [] };
          return { tasks: [{ type: 'drop', id: tid, at, today: ctx.today, nextId: cur.repeat && !flags.stop ? newId('t_') : null }] };
        };
        break;
      case 'undo':
        build = (fresh, goals) => {
          const cur = live(fresh);
          if (cur.status === 'open') return { tasks: [] };
          return { tasks: [{ type: 'reopen', id: tid }], goals: cur.status === 'done' ? goalCredit(ctx, goals, cur.goal, -1) : [] };
        };
        break;
      case 'delete':
        // Permanent (no record left); the app asks first, here it takes an explicit --yes.
        if (!flags.yes) fail(`delete removes “${t.title}” for good; to keep a record use “compass task drop”. Add --yes to delete it.`);
        build = () => ({ tasks: [{ type: 'delete', id: tid }] });
        break;
      case 'move': {
        const due = date(rest[1] ?? 'tomorrow');
        build = () => ({ tasks: [{ type: 'edit', id: tid, fields: { due } }] });
        break;
      }
      case 'focus':
      case 'unfocus':
        build = (fresh) => {
          const cur = live(fresh);
          if (sub === 'focus' && cur.status !== 'open') fail('only open tasks can have focus');
          if (sub === 'focus' && !cur.focus && !tasks.canFocus(fresh, tid)) focusFull(fresh);
          return { tasks: [{ type: 'focus', id: tid, focus: sub === 'focus' }] };
        };
        break;
      case 'edit': {
        /** @type {Partial<Task>} */
        const fields = {};
        if (str(flags.title)) fields.title = str(flags.title);
        if (str(flags.domain)) fields.domain = domainRef(ctx, /** @type {string} */ (str(flags.domain)));
        if (str(flags.due) !== undefined) fields.due = date(/** @type {string} */ (str(flags.due)));
        if (str(flags.repeat) !== undefined) {
          fields.repeat = rule(/** @type {string} */ (str(flags.repeat)), fields.due ?? t.due ?? ctx.today);
          if (fields.repeat && !(fields.due ?? t.due)) fields.due = tasks.firstDue(fields.repeat, ctx.today);
        }
        if (str(flags.goal) !== undefined) fields.goal = goalId(flags.goal);
        for (const k of /** @type {const} */ (['notes', 'ongoing'])) if (str(flags[k]) !== undefined) fields[k] = orNull(str(flags[k]));
        if (!Object.keys(fields).length) fail('nothing to edit');
        build = () => ({ tasks: [{ type: 'edit', id: tid, fields }] });
        break;
      }
      case 'sub': {
        const add = str(flags.add);
        if (add) {
          const subId = newId('s_');
          build = () => ({ tasks: [{ type: 'addSub', id: tid, sub: { id: subId, title: add, done: false } }] });
          break;
        }
        const ref = str(flags.remove) ?? rest[1];
        const q = String(ref ?? '').toLowerCase();
        const matches = t.subtasks.filter((s) => s.id === ref || s.title.toLowerCase().includes(q));
        if (!q || matches.length !== 1) fail(matches.length ? 'that matches several subtasks' : 'no subtask matches');
        const subId = matches[0].id;
        build = () => ({
          tasks: [str(flags.remove) ? { type: 'removeSub', id: tid, subId } : { type: 'toggleSub', id: tid, subId, done: !flags.undo }],
        });
        break;
      }
      default:
        return fail(`unknown task action “${sub}” (compass help)`);
    }
  }

  const res = writeTasks(ctx, build);
  report(res, ctx.sync);
  if (!res.message) return;
  const fresh = tasks.normalize(readJson(ctx.cfg, ctx.cfg.tasks));
  const saved = fresh.tasks.find((x) => x.id === id);
  if (!saved) return;
  const view = { ...ctx, tasks: fresh, goals: normalize(readJsonIfExists(ctx.cfg, ctx.cfg.goals) ?? emptyDoc()) };
  console.log(taskLine(saved, view));
  const next = saved.next ? fresh.tasks.find((x) => x.id === saved.next) : undefined;
  if (next) console.log(`next: ${taskLine(next, view)}`);
}

/**
 * @param {TasksDoc} doc
 * @returns {never}
 */
function focusFull(doc) {
  const list = tasks.focused(doc).map((t) => `  [${t.id}] ${t.title}`).join('\n');
  return fail(`already ${tasks.FOCUS_MAX} tasks with focus (unfocus one first):\n${list}`);
}

/** @param {Task} t @param {Ctx} ctx */
function showTask(t, ctx) {
  console.log(taskLine(t, ctx));
  for (const s of t.subtasks) console.log(`  ${s.done ? '[x]' : '[ ]'} ${s.title} (${s.id})`);
  if (t.notes) console.log(t.notes.split('\n').map((l) => `  | ${l}`).join('\n'));
}

/**
 * @param {{ pushed: boolean, message: string | null }} res @param {boolean} sync
 */
function report(res, sync) {
  if (!res.message) {
    console.log('No change.');
    return;
  }
  const subject = res.message.split('\n\n').join(' · ');
  console.log(`${subject}${res.pushed ? '' : sync ? ' (not pushed yet)' : ' (committed, not pushed: --no-sync)'}`);
}

/** @param {Ctx} ctx */
function listDomains(ctx) {
  const doc = ctx.domains;
  if (!doc.domains.length) console.log(`No domains registered (${ctx.cfg.domains}). Add one: compass domain add <id> --name N --path DIR`);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {import('../lib/domains.js').Domain} d @param {number} depth */
  const print = (d, depth) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    console.log(`${'  '.repeat(depth)}${d.id} — ${[d.name, ...(d.paths ?? []), ...(d.color ? [d.color] : [])].join(' · ')}`);
    for (const c of domains.children(doc, d.id)) print(c, depth + 1);
  };
  for (const d of doc.domains) if (!d.parent || !domains.find(doc, d.parent)) print(d, 0);
  for (const d of doc.domains) print(d, 0); // left out by a cycle
  const loose = [...new Set([...ctx.goals.goals.map((g) => g.category), ...ctx.tasks.tasks.map((t) => t.domain)])]
    .filter((c) => c && !domains.domainOfCategory(doc, c));
  if (doc.domains.length && loose.length) console.log(`Not registered (used by goals or tasks): ${loose.join(', ')}`);
  for (const p of domains.validate(doc)) console.error(`warning: ${p}`);
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function domain(ctx, sub, rest, flags) {
  const id = rest[0];
  if (!domains.isValidId(id)) fail('which domain? an id like "studies" or "studies/course-a" (no spaces)');
  /** @param {string} p */
  const abs = (p) => (p.startsWith('~') ? p : resolve(p));
  /** @type {import('../lib/domains.js').Op[]} */
  let ops;
  if (sub === 'add') {
    if (domains.find(ctx.domains, id)) fail(`“${id}” already exists`);
    const parent = str(flags.parent) ?? (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : undefined);
    if (parent && !domains.find(ctx.domains, parent)) fail(`the parent “${parent}” does not exist; add it first`);
    /** @type {import('../lib/domains.js').Domain} */
    const d = { id, name: str(flags.name) ?? id.slice(id.lastIndexOf('/') + 1) };
    if (parent) d.parent = parent;
    if (str(flags.path)) d.paths = [domains.cleanPath(abs(/** @type {string} */ (str(flags.path))))];
    if (str(flags.color)) d.color = str(flags.color);
    ops = [{ type: 'add', domain: d }];
  } else if (sub === 'edit') {
    if (!domains.find(ctx.domains, id)) fail(`unknown domain “${id}”`);
    ops = [];
    const color = str(flags.color);
    if (str(flags.name) || color) ops.push({ type: 'edit', id, fields: { ...(str(flags.name) ? { name: str(flags.name) } : {}), ...(color ? { color: orNull(color) } : {}) } });
    if (str(flags['add-path'])) ops.push({ type: 'addPath', id, path: abs(/** @type {string} */ (str(flags['add-path']))) });
    if (str(flags['remove-path'])) ops.push({ type: 'removePath', id, path: abs(/** @type {string} */ (str(flags['remove-path']))) });
    if (!ops.length) fail('nothing to edit');
  } else {
    return fail(`unknown domain action “${sub}” (compass help)`);
  }
  const res = commitChange(ctx.cfg, ctx.cfg.domains, (raw) => {
    const before = raw ? domains.normalize(raw) : domains.emptyDoc();
    return { text: domains.serialize(domains.applyOps(before, ops)), message: domains.commitMessage(ops) };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function listGoals(ctx, flags) {
  const { now, gtz: tz } = ctx;
  const cat = str(flags.category);
  const list = ctx.goals.goals.filter((g) => {
    if (cat && g.category !== cat) return false;
    if (flags.all) return true;
    if (flags.archived) return !!g.archived;
    if (flags.past) return !g.archived && isExpired(g, now, tz);
    return !g.archived && !isExpired(g, now, tz);
  });
  if (!list.length) console.log('No goals.');
  for (const g of list) console.log(goalLine(g, now, tz));
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function goal(ctx, sub, rest, flags) {
  const { cfg, now, gtz: tz } = ctx;
  const doc = ctx.goals;
  /** @type {(fresh: GoalsDoc) => Op[]} */
  let build;
  if (sub === 'add') {
    const title = str(flags.title);
    const category = str(flags.category);
    const horizon = /** @type {Horizon} */ (str(flags.horizon));
    if (!title || !category || !horizon) return fail('goal add needs --title, --category and --horizon');
    if (!HORIZONS.includes(horizon)) fail(`--horizon must be one of ${HORIZONS.join(', ')}`);
    const target = str(flags.target) ? positive(/** @type {string} */ (str(flags.target)), '--target') : null;
    const deadline = horizon === 'deadline' ? str(flags.deadline) ?? null : null;
    if (horizon === 'deadline' && !/^\d{4}-\d{2}-\d{2}$/.test(deadline ?? '')) fail('a deadline goal needs --deadline YYYY-MM-DD');
    const repeat = horizon !== 'deadline' && !!flags.repeat;
    if (!doc.categories.includes(category)) console.error(`note: new category “${category}”`);
    if (ctx.domains.domains.length && !domains.domainOfCategory(ctx.domains, category)) {
      console.error(`note: “${category}” is not a registered domain (see compass domains)`);
    }
    /** @type {Goal} */
    const g = {
      id: newId(), kind: 'goal', title, category, horizon,
      target, unit: target !== null ? str(flags.unit) ?? null : null, deadline, repeat,
      period: repeat || horizon === 'deadline' ? null : periodKey(horizon, now, tz),
      repo: str(flags.repo) ?? null, location: str(flags.location) ?? null, notes: str(flags.notes) ?? null,
      progress: {}, createdAt: now.toISOString(),
    };
    build = () => [{ type: 'add', goal: g }];
  } else {
    const g = findGoal(doc, rest[0]);
    const id = g.id;
    /** @param {GoalsDoc} fresh */
    const live = (fresh) => {
      const cur = fresh.goals.find((x) => x.id === id) ?? fail('the goal no longer exists');
      if (isExpired(cur, now, tz)) fail('the goal has expired (it is in Past); create a new one for this period');
      return cur;
    };
    switch (sub) {
      case 'inc': {
        const delta = rest[1] === undefined ? 1 : Number(rest[1].replace(',', '.'));
        if (!Number.isFinite(delta) || delta === 0) fail('delta must be a non-zero number');
        build = (fresh) => [{ type: 'inc', id, key: goalKey(live(fresh), now, tz), delta }];
        break;
      }
      case 'set': {
        const value = Number(String(rest[1] ?? '').replace(',', '.'));
        if (rest[1] === undefined || !Number.isFinite(value) || value < 0) fail('goal set needs a value ≥ 0');
        build = (fresh) => [{ type: 'set', id, key: goalKey(live(fresh), now, tz), value }];
        break;
      }
      case 'done':
        build = (fresh) => {
          const cur = live(fresh);
          return [{ type: 'set', id, key: goalKey(cur, now, tz), value: cur.target ?? 1 }];
        };
        break;
      case 'sub': {
        const q = String(rest[1] ?? '').toLowerCase();
        const matches = (g.subgoals ?? []).filter((s) => s.id === rest[1] || s.title.toLowerCase().includes(q));
        if (!q || matches.length !== 1) fail(matches.length ? 'that matches several sub-goals' : 'no sub-goal matches');
        const subId = matches[0].id;
        build = (fresh) => [{ type: 'toggleSub', id, subId, key: goalKey(live(fresh), now, tz), done: !flags.undo }];
        break;
      }
      case 'edit': {
        /** @type {Record<string, any>} */
        const fields = {};
        for (const k of ['title', 'category', 'unit', 'notes', 'location']) if (str(flags[k]) !== undefined) fields[k] = str(flags[k]);
        if (str(flags.target) !== undefined) fields.target = positive(/** @type {string} */ (str(flags.target)), '--target');
        if (!Object.keys(fields).length) fail('nothing to edit');
        build = () => [{ type: 'edit', id, fields }];
        break;
      }
      case 'archive':
      case 'unarchive':
        build = () => [{ type: 'archive', id, archived: sub === 'archive' }];
        break;
      default:
        return fail(`unknown goal action “${sub}” (compass help)`);
    }
  }

  const res = commitChange(cfg, cfg.goals, (raw) => {
    const before = raw ? normalize(raw) : emptyDoc(tz);
    const ops = build(before);
    const after = applyOps(before, ops);
    return { text: serialize(after), message: commitMessage(ops, before, after) };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
  if (!res.message) return;
  const fresh = normalize(readJson(cfg, cfg.goals));
  const g = sub === 'add' ? fresh.goals[fresh.goals.length - 1] : fresh.goals.find((x) => x.id === findGoal(doc, rest[0]).id);
  if (g) console.log(goalLine(g, now, tz));
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
