#!/usr/bin/env node
// @ts-check
// compass CLI: for scripts and agents (and anyone else) to read and change the data without editing
// the JSON by hand. Shares its logic with the app (`lib/`) and writes with operations, like the app.

import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { HORIZONS, addDays, daysUntil, deviceTimeZone, isValidTimeZone, periodKey, periodKeys } from '../lib/period.js';
import { applyOps, commitMessage, emptyDoc, isDone, isExpired, newId, normalize, serialize, subgoalsDone } from '../lib/goals.js';
import * as tasks from '../lib/tasks.js';
import * as domains from '../lib/domains.js';
import * as habits from '../lib/habits.js';
import * as sources from '../lib/sources.js';
import * as journal from '../lib/journal.js';
import * as events from '../lib/events.js';
import * as calendar from '../lib/calendar.js';
import * as cryptSync from './crypt.mjs';
import { tradesCmd } from './trades.mjs';
import { moneyCmd } from './finance.mjs';
import { webcrypto } from 'node:crypto';
import { buildToday } from '../lib/today.js';
import { NET_TIMEOUT, commitChange, commitFiles, loadConfig, pull, readJson, readJsonIfExists } from './repo.mjs';

/** @typedef {import('../lib/goals.js').Goal} Goal */
/** @typedef {import('../lib/goals.js').GoalsDoc} GoalsDoc */
/** @typedef {import('../lib/goals.js').Op} Op */
/** @typedef {import('../lib/period.js').Horizon} Horizon */
/** @typedef {import('../lib/tasks.js').Task} Task */
/** @typedef {import('../lib/tasks.js').TasksDoc} TasksDoc */
/** @typedef {import('../lib/domains.js').DomainsDoc} DomainsDoc */
/** @typedef {import('../lib/habits.js').Habit} Habit */
/** @typedef {import('../lib/habits.js').HabitsDoc} HabitsDoc */
/** @typedef {import('../lib/sources.js').Source} Source */
/** @typedef {import('../lib/sources.js').SourcesDoc} SourcesDoc */
/** @typedef {import('../lib/journal.js').JournalDoc} JournalDoc */
/** @typedef {import('../lib/events.js').Event} Event */
/** @typedef {import('../lib/events.js').EventsDoc} EventsDoc */
/** @typedef {import('./repo.mjs').Config} Config */

// lib/ uses the Web Crypto global, which Node only exposes from v19 on: give older Node (e.g. a
// distribution's system node, picked when no version manager is loaded) the same object.
if (!globalThis.crypto) globalThis.crypto = /** @type {Crypto} */ (/** @type {unknown} */ (webcrypto));

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
 * @property {HabitsDoc} habits
 * @property {SourcesDoc} sources
 * @property {EventsDoc} events
 * @property {boolean} sync
 */

const HELP = `compass — goals, tasks, events, habits, sources, journal, trades, money and domains from the command line

Usage:
  compass today [--domain D | --cwd PATH] [--timeout S]
                                        focus, then by domain: events and tasks late/today/next 7 days, goals.
                                        With a domain: in full (also tasks dated later and without a date, every
                                        active goal); its sub-domains with paths, agenda only (not its
                                        parents); from the root folder, every other domain too
                                        of the day and week, deadlines within 7 days, ongoing work
  compass tasks [--domain D | --cwd PATH] [--due today|week|overdue] [--all] [--archived]
                                        --archived: closed tasks moved to tasks-YYYY.json (after 30 days)
  compass task add "title" (--domain D | --cwd PATH) [--due DATE] [--repeat RULE]
                   [--ongoing PATH] [--notes T] [--location T] [--event E] [--focus]
                                        --event: the event it prepares (moves with it)
  compass task add --stdin [options]    one task per line ("title" --due fri …), all in one commit;
                                        options given here apply to every line
  compass task done|undo|drop|focus|unfocus|show <task>
  compass task delete <task> --yes      for good (drop keeps a record)
  compass task drop <task> --stop       a repeating task: no next occurrence
  compass task move <task> [DATE]       default: tomorrow
  compass task edit <task> [--title T] [--domain D] [--due DATE] [--repeat RULE]
                   [--ongoing PATH] [--notes T] [--location T] [--event E]   (none clears a field)
  compass task sub <task> <subtask> [--undo] | --add T | --remove <subtask>
  compass task link <task> <session> [--title T] [--parent <session>] [--subtask <subtask>] [--move]
                                        record a chat session working on the task (--parent: the chat that
                                        opened it; --subtask: the subtask it is about, inherited by its
                                        sub-chats; --move: take it from another task)
  compass task unlink <task> <session>…  forget chats (their sub-chats move up one level)
  compass task chats <task> [--prune <session>[,…]]
                                        the task's chats as a tree; --prune forgets the ones listed
  compass task brief <task>             starter text for a new chat on the task: title, notes, subtasks, date, chats
  compass events [--domain D | --cwd PATH] [--past]
                                        from today on (--past: the ones already over too)
  compass event add "title" (--domain D | --cwd PATH) --date DATE [--time HH:MM[-HH:MM]] [--until DATE]
                   [--location T] [--notes T] [--cal-id ID]
                                        no --time: all day (--until: last day); --cal-id: it is already in
                                        its domain's calendar with that id, exactly as given here
  compass event edit <event> [--title T] [--domain D] [--date DATE] [--time HH:MM[-HH:MM]|none]
                   [--until DATE|none] [--location T] [--notes T]
                                        a new date moves its open tasks (--event) by the same days
  compass event show <event> | delete <event> --yes
  compass calendar [status]             what the calendar copy is missing (domains with --calendar)
  compass calendar window               JSON: the calendars and days a sync has to read
  compass calendar sync [--remote FILE|-]
                                        JSON plan: pulls the calendar's changes (FILE: {"<calendar id>":
                                        [its events as the calendar returns them]}), lists what to push
                                        and the conflicts (changed on both sides, or deleted there)
  compass calendar done [FILE|-]        after pushing: [{"event": E, "calId": ID|null}, {"deleted": ID}]
  compass habits [--domain D | --cwd PATH] [--archived]
  compass habit add "title" (--domain D | --cwd PATH) --freq F [--notes T]
  compass habit done|undo <habit> [DATE…]  default today; also yesterday, -N, YYYY-MM-DD (several: one commit)
  compass habit edit <habit> [--title T] [--domain D] [--freq F] [--notes T]
  compass habit archive|unarchive <habit>
  compass habit delete <habit> --yes    for good, with its history (archive keeps it)
  compass sources [--domain D | --cwd PATH] [--kind K] [--status S]
                                        K: book, video, course, article, podcast; S: want, doing, done,
                                        dropped, skip (not for me: kept only as material)
  compass sources migrate               books.json → sources.json, once (every book keeps its data)
  compass source find "text"            search Open Library (books)
  compass source add "title" [--kind K] [--domain D | --cwd PATH] [--author A] [--url U] [--file F]
                   [--status S] [--find]
                                        no domain: general; --file: path inside the domain folder's sources/;
                                        --find: author and cover from the first Open Library match (books)
  compass source want|doing|done|dropped|skip <source>
                                        also the words of each kind (reading, watched, listening…); sets the
                                        dates: started on doing, finished on done/dropped
  compass source rate <source> 1-5|none
  compass source quote <source> "text" [--page N] | --remove <quote>
  compass source edit <source> [--title T] [--kind K] [--author A] [--url U] [--file F] [--domain D|none]
                   [--notes T] [--started DATE] [--finished DATE]   (none clears a field)
  compass source show <source>
  compass source delete <source> --yes
  compass journal [DATE]                one day (default today); the journal is encrypted: the password
                                        comes from $COMPASS_PASSPHRASE or the keyring (secret-tool)
  compass journal days [--last N]       the last N days (default 7)
  compass journal search "text"
  compass journal write "text" [--date DATE]   replaces that day's text ("none" clears it)
  compass journal note "text" [--date DATE]    adds a note
  compass journal unnote <note> [--date DATE]
  compass trades [--open] [--range R]   trades and the limits hit now; encrypted like the journal
  compass trades panel [--range R]      win rate, expectancy, R, PnL, drawdown; by setup, market, side,
                                        timeframe and discipline. R: month, quarter (3 months), year, all
  compass trades limits [--day R] [--week R] [--streak N]   in R (none clears); no option: show them
  compass trades area <domain>          the area whose page shows them
  compass trade add --symbol S --qty N --entry P --at TIME [--side long|short] [--market spot|perp|stock]
                    [--account A] [--leverage N] [--fees N] [--funding N] [--order-stop P] [--ext ID]
                    [--exit P --exit-at TIME --pnl NET]   (the exchanges' import adds them; this is for tests)
  compass trade close <trade> --exit P --pnl NET [--at TIME]
  compass trade edit <trade> [--stop-loss P] [--setup S] [--timeframe T] [--target P] [--emotion 1-5]
                    [--errors "a, b"] [--notes T]   (none clears a field)
  compass trade show|delete <trade> [--yes]
  compass money [YYYY-MM]               budget of the month (spent against limits, income, saved) and net worth;
                                        encrypted like the journal
  compass money uncategorized|movements [YYYY-MM]
  compass money categories              categories with this month's limit, and the rules
  compass money category add "name" [--limit N] | limit <cat> N|none [--from YYYY-MM] | rename <cat> "name"
                                        | remove <cat> --yes
  compass money rule add "text" <category|transfer> | remove <rule>   a movement containing the text
  compass money account set <id> [--kind bank|cash|defi|debt|other] [--balance N] [--currency C --rate R]
                    [--name N] [--address A] | remove <id>
  compass money add --amount N --text T [--date D] [--account A] [--category C|transfer] [--ext ID]
                    (the bank's import adds them; this is for tests)
  compass money categorize <movement> <category|transfer|none>
  compass money history                 net worth at the end of each month (kept on its own when the next opens)
  compass money close [YYYY-MM]         keeps the month's net worth now, replacing its row (default last month)
  compass money saving <goal> networth|saved <target> | none   the goal's progress from net worth
  compass money area <domain>           the area whose page shows the budget
  compass domains
  compass domains root PATH|none        the root folder (its chat sees the agenda of every domain)
  compass domain add <id> [--name N] [--parent P] [--path DIR…] [--color C]
  compass domain edit <id> [--name N] [--color C|none] [--add-path DIR…] [--remove-path DIR…]
                   [--calendar ID|none] [--calendar-color N|none]   (calendar of its events; inherited)
  compass domain move <id> --before <id>|--last   order among its siblings (as the app lists them)
  compass domain delete <id> --yes      only an empty one: no sub-domains, tasks, goals, habits or sources
  compass goals [--past|--archived|--all] [--category C]
  compass goal add --title T --category C --horizon day|week|month|quarter|year|deadline
                   [--target N] [--unit U] [--deadline YYYY-MM-DD]
                   [--notes T] [--location T] [--repo R]
  compass goal inc <goal> [delta]       add to its progress (default 1)
  compass goal set <goal> <value>
  compass goal done <goal>              set to its target (or 1 without target)
  compass goal sub <goal> <sub-goal> [--undo]
  compass goal edit <goal> [--title T] [--category C] [--target N] [--unit U] [--notes T] [--location T]
  compass goal archive|unarchive <goal>
  compass period [YYYY-MM-DD] [--tz Area/City] [--days YYYY-MM-DD]

<task>, <goal>: an id (t_…, g_…) or part of the title. D: a domain id or name. --cwd: the domain whose
"paths" contain that folder.
--path, --add-path and --remove-path can be repeated. S: want, reading, read, dropped. DATE: YYYY-MM-DD, today, tomorrow, +N, mon…sun, none. RULE: daily, every N days, weekly, mon,thu,
weekdays, monthly, monthly:15, none. F (habits): daily, 3/week (any days), mon,thu.
--no-sync skips git pull/push; --timeout S limits the pull (default 3 s for today, 20 s otherwise).
Config: ~/.config/compass/config.json →
  {"repo": "<data repo checkout>", "goals": "goals.json", "tasks": "tasks.json", "domains": "domains.json"}`;

/** Flags that never take a value. */
const BOOLEAN = new Set(['all', 'past', 'archived', 'undo', 'focus', 'stop', 'no-sync', 'help', 'yes', 'stdin', 'find', 'open']);

/**
 * `flags` keeps the last value of each flag; `lists` keeps every value of a repeated one (`--path A --path B`).
 * @param {string[]} argv
 */
function parse(argv) {
  /** @type {string[]} */
  const pos = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  /** @type {Record<string, string[]>} */
  const lists = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN.has(name) && next !== undefined && !next.startsWith('--')) {
        flags[name] = argv[++i];
        (lists[name] ??= []).push(argv[i]);
      } else flags[name] = true;
    } else pos.push(a);
  }
  return { pos, flags, lists };
}

/**
 * Splits a line into arguments the way a shell does: spaces separate them, "double quotes" (with \" and \\)
 * and 'single quotes' keep them together.
 * @param {string} line
 */
function splitArgs(line) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" || c === '"') {
      started = true;
      const end = c;
      for (i++; i < line.length && line[i] !== end; i++) {
        if (end === '"' && line[i] === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) i++;
        cur += line[i];
      }
      if (i >= line.length) fail(`unclosed ${end} in: ${line}`);
    } else if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/** @param {string | true | undefined} v */
const str = (v) => (typeof v === 'string' ? v : undefined);

/** Prefix for errors (the line being read with --stdin). */
let failContext = '';

/**
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  console.error(`error: ${failContext}${msg}`);
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
  const value = g.progress;
  const done = isDone(g);
  const progress = g.target ? `${fmt(value)}/${fmt(g.target)}${g.unit ? ` ${g.unit}` : ''}` : done ? 'done' : 'not done';
  const when = g.horizon === 'deadline'
    ? `due ${g.deadline} (${relDays(daysUntil(/** @type {string} */ (g.deadline), now, tz))})`
    : g.horizon;
  const bits = [progress, when, g.category];
  if (g.subgoals?.length) bits.push(`sub ${subgoalsDone(g)}/${g.subgoals.length}`);
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
  if (t.sessions?.length) bits.push(`chats ${t.sessions.length}`);
  if (t.ongoing) bits.push(`ongoing ${t.ongoing}`);
  if (t.event) bits.push(`for ${ctx.events.events.find((e) => e.id === t.event)?.title ?? t.event}`);
  if (t.location) bits.push(`@ ${t.location}`);
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
 * The domain of --domain, or the one whose paths contain --cwd (`root`: --cwd is the root folder).
 * @param {Ctx} ctx @param {Record<string, string | true>} flags
 * @returns {{ id: string | null, note: string | null, root: boolean }}
 */
function scopeFrom(ctx, flags) {
  const ref = str(flags.domain);
  if (ref) return { id: domainRef(ctx, ref), note: null, root: false };
  const cwd = str(flags.cwd);
  if (!cwd) return { id: null, note: null, root: false };
  const d = domains.resolvePath(ctx.domains, resolve(cwd), homedir());
  if (!d) return { id: null, note: 'no domain has a path containing --cwd', root: false };
  const root = domains.isRoot(ctx.domains, resolve(cwd), homedir());
  return { id: d.id, note: root ? 'from --cwd, the root folder' : 'from --cwd', root };
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
  const { pos, flags, lists } = parse(process.argv.slice(2));
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
    habits: habits.normalize(readJsonIfExists(cfg, cfg.habits) ?? habits.emptyDoc()),
    sources: sources.normalize(readJsonIfExists(cfg, cfg.sources) ?? sources.emptyDoc()),
    events: events.normalize(readJsonIfExists(cfg, cfg.events) ?? events.emptyDoc()),
  };

  switch (cmd) {
    case 'today': return today(ctx, flags);
    case 'tasks': return listTasks(ctx, flags);
    case 'task': return task(ctx, sub, rest, flags);
    case 'domains': return sub === 'root' ? domainsRoot(ctx, rest) : listDomains(ctx);
    case 'domain': return domain(ctx, sub, rest, flags, lists);
    case 'goals': return listGoals(ctx, flags);
    case 'goal': return goal(ctx, sub, rest, flags);
    case 'habits': return listHabits(ctx, flags);
    case 'habit': return habit(ctx, sub, rest, flags);
    case 'sources': return sub === 'migrate' ? migrateSources(ctx) : listSources(ctx, flags);
    case 'source': return source(ctx, sub, rest, flags);
    case 'journal': return journalCmd(ctx, sub, rest, flags);
    case 'events': return listEvents(ctx, flags);
    case 'event': return event(ctx, sub, rest, flags);
    case 'calendar': return calendarCmd(ctx, sub, rest, flags);
    case 'trades':
    case 'trade': return tradesCmd(ctx, KIT, cmd, sub, rest, flags);
    case 'money': return moneyCmd(ctx, KIT, sub, rest, flags);
    default: fail(`unknown command “${cmd}” (compass help)`);
  }
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function today(ctx, flags) {
  const scope = scopeFrom(ctx, flags);
  const view = buildToday({ goals: ctx.goals, tasks: ctx.tasks, domains: ctx.domains, events: ctx.events, now: ctx.now, tz: ctx.tz, scope: scope.id, root: scope.root });
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: ctx.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ctx.now);
  console.log(`Today · ${date} · ${view.date} · ${view.week} (${ctx.tz})`);
  if (scope.id) {
    const sc = domains.chatScope(ctx.domains, scope.id, scope.root);
    // Named: the sub-domains with paths right under its own part (not what is below those).
    const tops = [...sc.agenda].filter((id) => sc.own.has(domains.find(ctx.domains, id)?.parent ?? ''));
    const agenda = scope.root ? 'every other domain' : tops.map((id) => domains.label(ctx.domains, id)).join(', ');
    const what = `${domains.label(ctx.domains, scope.id)} [${scope.id}] in full${agenda ? ` + agenda of ${agenda}` : ''}`;
    console.log(`Scope: ${what}${scope.note ? ` (${scope.note})` : ''}`);
  } else if (scope.note) console.log(`Scope: everything (${scope.note})`);
  if (view.focus.length || view.focusElsewhere) {
    console.log('Focus');
    for (const t of view.focus) console.log(`  ${taskLine(t, ctx)}`);
    if (view.focusElsewhere) console.log(`  (+${view.focusElsewhere} in other domains)`);
  }
  if (!view.groups.length) console.log('Nothing due in the next 7 days.');
  const cal = calendarPending(ctx);
  if (cal) console.log(`Calendar: ${cal} (compass calendar)`);
  for (const g of view.groups) {
    const id = g.domain && g.label !== g.domain ? ` [${g.domain}]` : '';
    console.log(`${g.label}${id}${g.agenda ? ' · agenda only' : ''}`);
    for (const e of g.events) console.log(`  ${eventLine(e, ctx, { domain: false })}`);
    for (const t of g.tasks) console.log(`  ${taskLine(t, ctx, { domain: false })}`);
    for (const goal of g.goals) console.log(`  ${goalLine(goal, ctx.now, ctx.gtz)}`);
    for (const t of g.ongoing) console.log(`  ↳ ongoing [${t.id}] ${t.title} → ${t.ongoing}`);
    if (g.later.length) console.log('  Later');
    for (const t of g.later) console.log(`  ${taskLine(t, ctx, { domain: false })}`);
    if (g.undated.length) console.log('  No date');
    for (const t of g.undated) console.log(`  ${taskLine(t, ctx, { domain: false })}`);
  }
}

/** Every task in the yearly archives (tasks-YYYY.json next to tasks.json), oldest year first. @param {Ctx} ctx */
function archivedTasks(ctx) {
  const dir = join(ctx.cfg.repo, dirname(ctx.cfg.tasks));
  const base = basename(ctx.cfg.tasks).replace(/\.json$/, '');
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => new RegExp(`^${base}-\\d{4}\\.json$`).test(n)).sort();
  } catch {
    // no folder yet
  }
  return names.flatMap((n) => tasks.normalize(readJson(ctx.cfg, join(dirname(ctx.cfg.tasks), n))).tasks);
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function listTasks(ctx, flags) {
  const scope = scopeFrom(ctx, flags);
  if (scope.note && !scope.id) console.error(`note: ${scope.note}; listing every domain`);
  const own = scope.id ? domains.scope(ctx.domains, scope.id).own : null;
  const due = str(flags.due);
  if (due && !['today', 'week', 'overdue'].includes(due)) fail('--due must be today, week or overdue');
  const list = (flags.archived ? archivedTasks(ctx) : ctx.tasks.tasks)
    .filter((t) => (flags.all || flags.archived || t.status === 'open')
      && (!own || own.has(domains.canonical(ctx.domains, t.domain)))
      && (!due || (t.status === 'open' && tasks.isDueWithin(t, /** @type {'today'|'week'|'overdue'} */ (due), ctx.today))))
    .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || tasks.byDue(a, b));
  if (!list.length) console.log('No tasks.');
  for (const t of list) console.log(taskLine(t, ctx));
}

/**
 * A change to tasks.json.
 * @typedef {{ tasks: import('../lib/tasks.js').Op[] }} Plan
 */

/**
 * Writes a plan built on the freshest versions of the files (and builds it again if the push
 * has to be retried). Closed tasks older than tasks.ARCHIVE_AFTER_DAYS move, in the same commit,
 * to the archive of the year they were closed (tasks-YYYY.json).
 * @param {Ctx} ctx @param {(t: TasksDoc) => Plan} build
 */
function writeTasks(ctx, build) {
  const { cfg } = ctx;
  // Archives that may receive tasks, from the local copy (the files must be known before reading).
  const local = readJsonIfExists(cfg, cfg.tasks);
  const years = local ? Object.keys(tasks.splitArchive(tasks.normalize(local), ctx.today).byYear) : [];
  const archives = years.map((y) => tasks.archivePath(cfg.tasks, y));
  return commitFiles(cfg, [cfg.tasks, ...archives], (docs) => {
    const tBefore = docs[cfg.tasks] ? tasks.normalize(docs[cfg.tasks]) : tasks.emptyDoc(ctx.tz);
    const plan = build(tBefore);
    /** @type {Record<string, string>} */
    const files = {};
    const messages = [];
    if (plan.tasks.length) {
      let after = tasks.applyOps(tBefore, plan.tasks);
      messages.push(tasks.commitMessage(plan.tasks, tBefore, after));
      const split = tasks.splitArchive(after, ctx.today);
      let moved = 0;
      for (const [year, list] of Object.entries(split.byYear)) {
        const rel = tasks.archivePath(cfg.tasks, year);
        if (!(rel in docs)) continue; // a year not seen in the local copy: next time
        const archive = docs[rel] ? tasks.normalize(docs[rel]) : tasks.emptyDoc(after.timeZone);
        const ids = new Set(list.map((t) => t.id));
        files[rel] = tasks.serialize({ ...archive, tasks: [...archive.tasks.filter((t) => !ids.has(t.id)), ...list] });
        after = { ...after, tasks: after.tasks.filter((t) => !ids.has(t.id)) };
        moved += list.length;
      }
      files[cfg.tasks] = tasks.serialize(after);
      if (moved) messages.push(`tasks: archived ${moved} closed ${moved === 1 ? 'task' : 'tasks'}`);
    }
    return messages.length ? { files, message: messages.join('\n\n') } : null;
  }, { sync: ctx.sync });
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
  /** @type {string[]} tasks to show once saved */
  let ids = [];
  /** @type {(t: TasksDoc) => Plan} */
  let build;

  /**
   * A new task from the arguments of `task add`.
   * @param {string[]} args @param {Record<string, string | true>} opts
   */
  const newOne = (args, opts) => {
    const title = args[0] ?? str(opts.title);
    if (!title) fail('task add needs a title: compass task add "title" --domain D');
    const scope = scopeFrom(ctx, opts);
    if (!scope.id) fail(scope.note ? `${scope.note}; use --domain` : 'a task needs a domain: --domain D (or --cwd PATH)');
    const due = str(opts.due) !== undefined ? date(/** @type {string} */ (str(opts.due))) : null;
    const repeat = str(opts.repeat) ? rule(/** @type {string} */ (str(opts.repeat)), due ?? ctx.today) : null;
    const t = tasks.newTask({
      title, domain: /** @type {string} */ (scope.id), due: repeat && !due ? tasks.firstDue(repeat, ctx.today) : due,
      repeat, ongoing: orNull(str(opts.ongoing)), notes: orNull(str(opts.notes)), location: orNull(str(opts.location)),
      ...(str(opts.event) ? { event: findEvent(ctx.events, str(opts.event)).id } : {}),
    }, ctx.now);
    return { t, focus: !!opts.focus };
  };

  if (sub === 'add') {
    /** @type {{ t: Task, focus: boolean }[]} */
    let items;
    if (flags.stdin) {
      // One task per line; the options of the command apply to every line (a line's own domain or folder wins).
      const { stdin: _stdin, ...defaults } = flags;
      const lines = readFileSync(0, 'utf8').split('\n').map((l) => l.trim());
      items = lines.flatMap((line, i) => {
        if (!line || line.startsWith('#')) return [];
        failContext = `line ${i + 1}: `;
        const { pos, flags: own } = parse(splitArgs(line));
        const base = own.domain || own.cwd ? { ...defaults, domain: undefined, cwd: undefined } : defaults;
        const item = newOne(pos, /** @type {Record<string, string | true>} */ ({ ...base, ...own }));
        failContext = '';
        return [item];
      });
      if (!items.length) fail('no tasks on stdin (one per line: "title" --domain D --due DATE …)');
    } else {
      items = [newOne(rest, flags)];
    }
    ids = items.map((x) => x.t.id);
    build = (fresh) => {
      /** @type {import('../lib/tasks.js').Op[]} */
      const ops = [];
      for (const { t, focus } of items) {
        ops.push({ type: 'add', task: t });
        if (!focus) continue;
        if (!tasks.canFocus(tasks.applyOps(fresh, ops), t.id)) focusFull(fresh);
        ops.push({ type: 'focus', id: t.id, focus: true });
      }
      return { tasks: ops };
    };
  } else {
    const t = findTask(ctx.tasks, rest[0], sub === 'undo' || sub === 'delete');
    const tid = t.id;
    ids = [tid];
    /** @param {TasksDoc} fresh */
    const live = (fresh) => fresh.tasks.find((x) => x.id === tid) ?? fail('the task no longer exists');
    switch (sub) {
      case 'show':
        return showTask(t, ctx);
      case 'done':
        build = (fresh) => {
          const cur = live(fresh);
          if (cur.status !== 'open') return { tasks: [] };
          return { tasks: [{ type: 'done', id: tid, at, today: ctx.today, nextId: cur.repeat ? newId('t_') : null }] };
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
        build = (fresh) => {
          const cur = live(fresh);
          if (cur.status === 'open') return { tasks: [] };
          return { tasks: [{ type: 'reopen', id: tid }] };
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
        for (const k of /** @type {const} */ (['notes', 'ongoing', 'location'])) if (str(flags[k]) !== undefined) fields[k] = orNull(str(flags[k]));
        if (str(flags.event) !== undefined) fields.event = orNull(str(flags.event)) === null ? null : findEvent(ctx.events, str(flags.event)).id;
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
      case 'link': {
        const session = rest[1] ?? fail('which chat session? compass task link <task> <session>');
        const parent = str(flags.parent);
        const subRef = str(flags.subtask);
        const title = str(flags.title) ?? '';
        build = (fresh) => {
          const cur = live(fresh);
          if (parent && !cur.sessions?.some((c) => c.id === parent)) fail(`“${parent}” is not a chat of this task (link it first)`);
          const subId = subRef === undefined ? undefined : subtaskRef(cur, subRef).id;
          const chat = { id: session, title, parent: parent ?? null, ...(subId ? { subtask: subId } : {}), addedAt: at };
          return { tasks: [{ type: flags.move ? 'relink' : 'link', id: tid, chat }] };
        };
        break;
      }
      case 'unlink':
        if (rest.length < 2) fail('which chat sessions? compass task unlink <task> <session>…');
        build = () => ({ tasks: [{ type: 'unlink', id: tid, sessions: rest.slice(1) }] });
        break;
      case 'chats': {
        const gone = (str(flags.prune) ?? '').split(/[\s,]+/).filter(Boolean);
        if (flags.prune === true || (str(flags.prune) !== undefined && !gone.length)) fail('--prune needs session ids: --prune a,b');
        if (!gone.length) return showChats(t);
        build = () => ({ tasks: [{ type: 'unlink', id: tid, sessions: gone }] });
        break;
      }
      case 'brief':
        return brief(t, ctx);
      default:
        return fail(`unknown task action “${sub}” (compass help)`);
    }
  }

  const res = writeTasks(ctx, build);
  report(res, ctx.sync);
  if (!res.message) return;
  const fresh = tasks.normalize(readJson(ctx.cfg, ctx.cfg.tasks));
  const view = { ...ctx, tasks: fresh };
  for (const id of ids) {
    const saved = fresh.tasks.find((x) => x.id === id);
    if (!saved) continue;
    console.log(taskLine(saved, view));
    const next = saved.next ? fresh.tasks.find((x) => x.id === saved.next) : undefined;
    if (next) console.log(`next: ${taskLine(next, view)}`);
  }
}

/**
 * A subtask of a task by id or part of its title.
 * @param {Task} t @param {string} ref
 */
function subtaskRef(t, ref) {
  const q = ref.toLowerCase();
  const exact = t.subtasks.filter((s) => s.id === ref);
  const matches = exact.length ? exact : t.subtasks.filter((s) => q && s.title.toLowerCase().includes(q));
  if (matches.length !== 1) fail(matches.length ? `“${ref}” matches several subtasks` : `no subtask of this task matches “${ref}”`);
  return matches[0];
}

/**
 * The chats of a task as an indented tree (nothing printed if it has none).
 * @param {Task} t @param {string} [indent]
 */
function chatLines(t, indent = '') {
  /** @type {string[]} */
  const lines = [];
  /** @param {ReturnType<typeof tasks.chatTree>} nodes @param {number} depth */
  const walk = (nodes, depth) => {
    for (const { chat, children } of nodes) {
      const subId = tasks.chatSubtask(t, chat.id);
      const subTitle = subId ? t.subtasks.find((s) => s.id === subId)?.title : undefined;
      lines.push(`${indent}${'  '.repeat(depth)}- ${chat.title || '(untitled)'} [${chat.id}]${subTitle ? ` — subtask: ${subTitle}` : ''}`);
      walk(children, depth + 1);
    }
  };
  walk(tasks.chatTree(t), 0);
  return lines;
}

/** @param {Task} t */
function showChats(t) {
  const lines = chatLines(t);
  console.log(lines.length ? lines.join('\n') : `No chats linked to “${t.title}”.`);
}

/**
 * Starter text for a chat about a task. Plain text: the caller adds its own instructions.
 * @param {Task} t @param {Ctx} ctx
 */
function brief(t, ctx) {
  const out = [`Task: ${t.title} [${t.id}]`, `Domain: ${t.domain}${t.due ? ` · due ${t.due} (${relDays(daysUntil(t.due, ctx.today, 'UTC'))})` : ''}${t.status !== 'open' ? ` · ${t.status}` : ''}`];
  if (t.location) out.push(`Where: ${t.location}`);
  if (t.ongoing) out.push(`Work in progress: ${t.ongoing}`);
  if (t.notes) out.push('Notes:', ...t.notes.split('\n').map((l) => `  ${l}`));
  if (t.subtasks.length) out.push('Subtasks:', ...t.subtasks.map((s) => `  ${s.done ? '[x]' : '[ ]'} ${s.title} [${s.id}]`));
  const chats = chatLines(t, '  ');
  if (chats.length) out.push('Chats already on it:', ...chats);
  console.log(out.join('\n'));
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
  const chats = chatLines(t, '  ');
  if (chats.length) console.log(['  chats:', ...chats].join('\n'));
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
    const cal = d.calendar ? [`calendar ${d.calendar.slice(0, 12)}…${d.calendarColor ? ` color ${d.calendarColor}` : ''}`] : d.calendarColor ? [`calendar color ${d.calendarColor}`] : [];
    console.log(`${'  '.repeat(depth)}${d.id} — ${[d.name, ...(d.paths ?? []), ...(d.color ? [d.color] : []), ...cal].join(' · ')}`);
    for (const c of domains.children(doc, d.id)) print(c, depth + 1);
  };
  for (const d of doc.domains) if (!d.parent || !domains.find(doc, d.parent)) print(d, 0);
  for (const d of doc.domains) print(d, 0); // left out by a cycle
  if (doc.root) console.log(`root folder: ${doc.root} (its chat sees the agenda of every domain)`);
  const loose = [...new Set([...ctx.goals.goals.map((g) => g.category), ...ctx.tasks.tasks.map((t) => t.domain), ...ctx.habits.habits.map((h) => h.domain), ...ctx.sources.sources.map((s) => s.domain), ...ctx.events.events.map((e) => e.domain)])]
    .filter((c) => c && !domains.domainOfCategory(doc, c));
  if (doc.domains.length && loose.length) console.log(`Not registered (used by goals, tasks, habits or sources): ${loose.join(', ')}`);
  for (const p of domains.validate(doc)) console.error(`warning: ${p}`);
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags @param {Record<string, string[]>} lists
 */
function domain(ctx, sub, rest, flags, lists) {
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
    const paths = [...new Set((lists.path ?? []).map((p) => domains.cleanPath(abs(p))))];
    if (paths.length) d.paths = paths;
    if (str(flags.color)) d.color = str(flags.color);
    ops = [{ type: 'add', domain: d }];
  } else if (sub === 'edit') {
    if (!domains.find(ctx.domains, id)) fail(`unknown domain “${id}”`);
    ops = [];
    /** @type {import('../lib/domains.js').Op & { type: 'edit' }} */
    const edit = { type: 'edit', id, fields: {} };
    if (str(flags.name)) edit.fields.name = str(flags.name);
    for (const [flag, k] of /** @type {const} */ ([['color', 'color'], ['calendar', 'calendar'], ['calendar-color', 'calendarColor']])) {
      if (str(flags[flag]) !== undefined) edit.fields[k] = orNull(str(flags[flag]));
    }
    if (Object.keys(edit.fields).length) ops.push(edit);
    for (const p of lists['add-path'] ?? []) ops.push({ type: 'addPath', id, path: abs(p) });
    for (const p of lists['remove-path'] ?? []) ops.push({ type: 'removePath', id, path: abs(p) });
    if (!ops.length) fail('nothing to edit');
  } else if (sub === 'move') {
    const d = domains.find(ctx.domains, id);
    if (!d) fail(`unknown domain “${id}”`);
    const before = str(flags.before);
    if (!before && !flags.last) fail('where to? --before <sibling id> or --last');
    if (before) {
      const b = domains.find(ctx.domains, before);
      if (!b || b.id === id || b.parent !== d?.parent) fail(`“${before}” is not a sibling of “${id}”`);
    }
    ops = [{ type: 'move', id, before: before ?? null }];
  } else if (sub === 'delete') {
    if (!domains.find(ctx.domains, id)) fail(`unknown domain “${id}”`);
    const kids = domains.children(ctx.domains, id);
    if (kids.length) fail(`“${id}” has sub-domains (${kids.map((d) => d.id).join(', ')}); delete or move them first`);
    const used = domains.usage(ctx.domains, id, {
      tasks: ctx.tasks.tasks.map((t) => t.domain),
      goals: ctx.goals.goals.map((g) => g.category),
      habits: ctx.habits.habits.map((x) => x.domain),
      sources: ctx.sources.sources.map((s) => s.domain),
      events: ctx.events.events.map((e) => e.domain),
    });
    if (used.length) fail(`“${id}” is still used by ${used.map(([what, n]) => `${n} ${what}`).join(', ')}; move them first`);
    if (!flags.yes) fail(`delete removes the domain “${id}” for good. Add --yes to delete it.`);
    ops = [{ type: 'delete', id }];
  } else {
    return fail(`unknown domain action “${sub}” (compass help)`);
  }
  const res = commitChange(ctx.cfg, ctx.cfg.domains, (raw) => {
    const before = raw ? domains.normalize(raw) : domains.emptyDoc();
    return { text: domains.serialize(domains.applyOps(before, ops)), message: domains.commitMessage(ops) };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
}

/** compass domains root PATH|none: the root folder. @param {Ctx} ctx @param {string[]} rest */
function domainsRoot(ctx, rest) {
  const raw = rest[0];
  if (!raw) return console.log(ctx.domains.root ? `root: ${ctx.domains.root}` : 'No root folder (compass domains root PATH).');
  const path = ['none', ''].includes(raw.toLowerCase()) ? null : raw.startsWith('~') ? raw : resolve(raw);
  if (path && !domains.resolvePath(ctx.domains, path, homedir())) fail(`no domain has a path containing ${path}: add it to a domain first`);
  /** @type {import('../lib/domains.js').Op[]} */
  const ops = [{ type: 'setRoot', path }];
  const res = commitChange(ctx.cfg, ctx.cfg.domains, (raw) => {
    const before = raw ? domains.normalize(raw) : domains.emptyDoc();
    return { text: domains.serialize(domains.applyOps(before, ops)), message: domains.commitMessage(ops) };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
}

/**
 * One line per habit: ✓ done today, its frequency, how this week is going and its domain.
 * @param {Habit} h @param {Ctx} ctx
 */
function habitLine(h, ctx) {
  const { done, of } = habits.weekProgress(h, ctx.today);
  const bits = [habits.freqText(h.freq), `${done}/${of} this week`, h.domain];
  if (h.archived) bits.push('archived');
  return `${habits.isDoneOn(h, ctx.today) ? '✓' : '·'} [${h.id}] ${h.title} — ${bits.join(' · ')}`;
}

/**
 * @param {HabitsDoc} doc @param {string | undefined} ref
 * @returns {Habit}
 */
function findHabit(doc, ref) {
  if (!ref) fail('which habit? (id or part of the title)');
  const byId = doc.habits.find((x) => x.id === ref);
  if (byId) return byId;
  const q = ref.toLowerCase();
  const all = doc.habits.filter((x) => x.title.toLowerCase().includes(q));
  const live = all.filter((x) => !x.archived);
  const pool = live.length ? live : all;
  if (pool.length === 1) return pool[0];
  if (!pool.length) fail(`no habit matches “${ref}”`);
  return fail(`“${ref}” matches several habits:\n${pool.map((x) => `  [${x.id}] ${x.title}`).join('\n')}`);
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function listHabits(ctx, flags) {
  const scope = scopeFrom(ctx, flags);
  if (scope.note && !scope.id) console.error(`note: ${scope.note}; listing every domain`);
  const own = scope.id ? domains.scope(ctx.domains, scope.id).own : null;
  const list = ctx.habits.habits.filter((h) => !!h.archived === !!flags.archived && (!own || own.has(domains.canonical(ctx.domains, h.domain))));
  if (!list.length) console.log(flags.archived ? 'No archived habits.' : 'No habits.');
  for (const h of list) console.log(habitLine(h, ctx));
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function habit(ctx, sub, rest, flags) {
  /** @param {string} text */
  const freq = (text) => attempt(() => habits.parseFreq(text));
  /** @type {habits.Op[]} */
  let ops;
  /** @type {string} */
  let id;
  if (sub === 'add') {
    const title = rest[0] ?? str(flags.title);
    if (!title) fail('habit add needs a title: compass habit add "title" --domain D --freq daily');
    const scope = scopeFrom(ctx, flags);
    if (!scope.id) fail(scope.note ? `${scope.note}; use --domain` : 'a habit needs a domain: --domain D (or --cwd PATH)');
    if (!str(flags.freq)) fail('a habit needs --freq: daily, 3/week or mon,thu');
    const h = habits.newHabit({ title, domain: /** @type {string} */ (scope.id), freq: freq(/** @type {string} */ (str(flags.freq))), notes: orNull(str(flags.notes)) }, ctx.now);
    id = h.id;
    ops = [{ type: 'add', habit: h }];
  } else {
    const h = findHabit(ctx.habits, rest[0]);
    id = h.id;
    switch (sub) {
      case 'done':
      case 'undo': {
        /** @param {string} raw */
        const day = (raw) => {
          const text = raw.trim().toLowerCase();
          const back = /^-(\d+)$/.exec(text);
          const date = text === 'yesterday' ? addDays(ctx.today, -1) : back ? addDays(ctx.today, -Number(back[1])) : attempt(() => tasks.parseDue(text, ctx.today));
          if (!date) fail('which day? (today, yesterday, -N or YYYY-MM-DD)');
          if (date > ctx.today) fail(`${date} has not come yet`);
          return date;
        };
        const dates = [...new Set((rest.length > 1 ? rest.slice(1) : ['today']).map(day))].sort();
        ops = dates.map((date) => ({ type: /** @type {const} */ ('mark'), id, date, done: sub === 'done' }));
        break;
      }
      case 'edit': {
        /** @type {Partial<Pick<Habit, 'title'|'domain'|'freq'|'notes'>>} */
        const fields = {};
        if (str(flags.title)) fields.title = /** @type {string} */ (str(flags.title));
        if (str(flags.domain)) fields.domain = domainRef(ctx, /** @type {string} */ (str(flags.domain)));
        if (str(flags.freq)) fields.freq = freq(/** @type {string} */ (str(flags.freq)));
        if (str(flags.notes) !== undefined) fields.notes = orNull(str(flags.notes));
        if (!Object.keys(fields).length) fail('nothing to change: --title, --domain, --freq or --notes');
        ops = [{ type: 'edit', id, fields }];
        break;
      }
      case 'archive':
      case 'unarchive':
        ops = [{ type: 'archive', id, archived: sub === 'archive' }];
        break;
      case 'delete':
        if (!flags.yes) fail(`delete removes “${h.title}” and its history for good; to keep them use “compass habit archive”. Add --yes to delete it.`);
        ops = [{ type: 'delete', id }];
        break;
      default:
        return fail(`unknown habit action “${sub}” (compass help)`);
    }
  }
  const res = commitChange(ctx.cfg, ctx.cfg.habits, (raw) => {
    const before = raw ? habits.normalize(raw) : habits.emptyDoc(ctx.tz);
    const after = habits.applyOps(before, ops);
    if (habits.serialize(after) === habits.serialize(before)) return null;
    return { text: habits.serialize(after), message: habits.commitMessage(ops, before, after) };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
  const saved = habits.normalize(readJsonIfExists(ctx.cfg, ctx.cfg.habits)).habits.find((x) => x.id === id);
  if (saved) console.log(habitLine(saved, ctx));
}

/**
 * One line per source: kind, status, author, rating, dates and domain.
 * @param {Source} s @param {{ domain?: boolean }} [opts]
 */
function sourceLine(s, opts = {}) {
  const mark = { doing: '▸', want: '·', done: '✓', dropped: '✗', skip: '–' }[s.status];
  const bits = [s.kind, sources.statusText(s).toLowerCase()];
  if (s.author) bits.push(s.author);
  if (s.rating) bits.push('★'.repeat(s.rating));
  if (s.started || s.finished) bits.push([s.started ?? '?', s.finished ?? ''].join(' → ').replace(/ → $/, ''));
  if (s.quotes.length) bits.push(`${s.quotes.length} quote${s.quotes.length === 1 ? '' : 's'}`);
  if (s.notes) bits.push('notes');
  if (opts.domain !== false && s.domain) bits.push(s.domain);
  return `${mark} [${s.id}] ${s.title} — ${bits.join(' · ')}`;
}

/** @param {SourcesDoc} doc @param {string | undefined} ref @returns {Source} */
function findSource(doc, ref) {
  if (!ref) fail('which source? (id or part of the title)');
  const byId = doc.sources.find((x) => x.id === ref);
  if (byId) return byId;
  const q = ref.toLowerCase();
  const pool = doc.sources.filter((x) => x.title.toLowerCase().includes(q));
  if (pool.length === 1) return pool[0];
  if (!pool.length) fail(`no source matches “${ref}”`);
  return fail(`“${ref}” matches several sources:\n${pool.map((x) => `  [${x.id}] ${x.title}`).join('\n')}`);
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function listSources(ctx, flags) {
  if (needsMigration(ctx)) console.error('note: there is a books.json and no sources.json yet: run compass sources migrate');
  const scope = scopeFrom(ctx, flags);
  if (scope.note && !scope.id) console.error(`note: ${scope.note}; listing every domain`);
  const own = scope.id ? domains.scope(ctx.domains, scope.id).own : null;
  /** @template T @param {string} name @param {(text: string) => T} parse @returns {T | null} */
  const filter = (name, parse) => (str(flags[name]) ? attempt(() => parse(/** @type {string} */ (str(flags[name])))) : null);
  const kind = filter('kind', sources.parseKind);
  const status = filter('status', sources.parseStatus);
  const list = ctx.sources.sources
    .filter((s) => (!own || (s.domain && own.has(domains.canonical(ctx.domains, s.domain))))
      && (!kind || s.kind === kind) && (!status || s.status === status))
    .sort(sources.byStatus);
  if (!list.length) console.log('No sources.');
  for (const s of list) console.log(sourceLine(s));
}

/** @param {Source} s */
function showSource(s) {
  console.log(sourceLine(s));
  if (s.url) console.log(`  Link: ${s.url}`);
  if (s.file) console.log(`  File: sources/${s.file}`);
  if (s.olid || s.cover) console.log(`  Open Library: ${[s.olid && `${sources.OPEN_LIBRARY}/works/${s.olid}`, s.cover && sources.coverUrl(s.cover)].filter(Boolean).join(' · ')}`);
  if (s.notes) console.log(s.notes.split('\n').map((l) => `  | ${l}`).join('\n'));
  for (const q of s.quotes) console.log(`  “${q.text}”${q.page ? ` (p. ${q.page})` : ''} [${q.id}]`);
}

/** A books.json from before sources, and no sources.json yet. @param {Ctx} ctx */
const needsMigration = (ctx) => !ctx.sources.sources.length && readJsonIfExists(ctx.cfg, ctx.cfg.sources) === null && readJsonIfExists(ctx.cfg, ctx.cfg.books) !== null;

/** books.json → sources.json in one commit: every book keeps its data. @param {Ctx} ctx */
function migrateSources(ctx) {
  const { sources: to, books: from } = ctx.cfg;
  const res = commitFiles(ctx.cfg, [to, from], (docs) => {
    if (docs[to] !== null) fail(`${to} already exists: nothing to migrate`);
    if (docs[from] === null) fail(`there is no ${from} to migrate`);
    const doc = sources.normalize(docs[from]);
    const n = doc.sources.length;
    return { files: { [to]: sources.serialize(doc), [from]: null }, message: `sources: from ${from} (${n} book${n === 1 ? '' : 's'})` };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
}

/** Open Library search with a time limit. @param {string} query @param {number} [limit] */
async function findOnline(query, limit) {
  try {
    return await sources.search(query, { limit, signal: AbortSignal.timeout(NET_TIMEOUT) });
  } catch (e) {
    return fail(`could not search Open Library: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** @param {sources.Found} f */
const foundLine = (f) => `${f.title} — ${[f.author, f.year, f.olid].filter(Boolean).join(' · ')}`;

/** Sub-commands that are not a status. */
const SOURCE_ACTIONS = new Set(['find', 'add', 'show', 'rate', 'quote', 'edit', 'delete']);

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
async function source(ctx, sub, rest, flags) {
  /** @param {string} raw @param {string} what @param {number} min @param {number} [max] */
  const int = (raw, what, min, max = Infinity) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${what} must be a whole number${max < Infinity ? ` from ${min} to ${max}` : ` of at least ${min}`}`);
    return n;
  };
  /** @type {sources.Op[]} */
  let ops;
  /** @type {string} */
  let id;
  if (needsMigration(ctx)) fail('there is a books.json and no sources.json yet: run compass sources migrate first');
  if (sub === 'find') {
    const query = rest.join(' ').trim();
    if (!query) fail('source find needs some text: compass source find "title or author"');
    const found = await findOnline(query, 8);
    if (!found.length) console.log('Nothing found.');
    for (const f of found) console.log(foundLine(f));
    return;
  }
  if (sub === 'add') {
    const title = rest[0] ?? str(flags.title);
    if (!title) fail('source add needs a title: compass source add "title" [--kind K] [--domain D]');
    // No domain (or a folder of none): general, in no area.
    const domain = scopeFrom(ctx, flags).id;
    const kind = str(flags.kind) ? attempt(() => sources.parseKind(/** @type {string} */ (str(flags.kind)))) : 'book';
    /** @type {Partial<Source>} */
    const fields = { kind, author: orNull(str(flags.author)), url: orNull(str(flags.url)), file: orNull(str(flags.file)) };
    if (flags.find) {
      if (kind !== 'book') fail('--find searches Open Library: only for books');
      const [f] = await findOnline([title, fields.author].filter(Boolean).join(' '), 1);
      if (!f) console.error('note: nothing found on Open Library; added without cover');
      else {
        console.log(`Open Library: ${foundLine(f)}`);
        Object.assign(fields, { author: fields.author ?? f.author, olid: f.olid, cover: f.cover });
      }
    }
    let s = sources.newSource({ title, domain, ...fields }, ctx.now);
    const status = str(flags.status) ? attempt(() => sources.parseStatus(/** @type {string} */ (str(flags.status)))) : 'want';
    s = { ...s, ...sources.withStatus(s, status, ctx.today) };
    id = s.id;
    ops = [{ type: 'add', source: s }];
  } else {
    if (!sub) fail('which action? compass help');
    // A status: want, doing, done, dropped, skip (or reading, watched…).
    const status = SOURCE_ACTIONS.has(sub) ? null : attempt(() => sources.parseStatus(sub));
    const s = findSource(ctx.sources, rest[0]);
    id = s.id;
    if (status) ops = [{ type: 'status', id, status, today: ctx.today }];
    else switch (sub) {
      case 'show':
        return showSource(s);
      case 'rate':
        if (!rest[1]) fail('which rating? compass source rate <source> 1-5 (or none)');
        ops = [{ type: 'edit', id, fields: { rating: orNull(rest[1]) === null ? null : int(rest[1], 'the rating', 1, 5) } }];
        break;
      case 'quote': {
        const remove = str(flags.remove);
        if (remove) {
          if (!s.quotes.some((q) => q.id === remove)) fail(`“${s.title}” has no quote ${remove} (compass source show)`);
          ops = [{ type: 'removeQuote', id, quoteId: remove }];
          break;
        }
        const text = rest[1]?.trim();
        if (!text) fail('which quote? compass source quote <source> "text" [--page N]');
        const page = str(flags.page) ? int(/** @type {string} */ (str(flags.page)), '--page', 1) : null;
        ops = [{ type: 'addQuote', id, quote: { id: sources.newId('q_'), text, page } }];
        break;
      }
      case 'edit': {
        /** @type {sources.SourceFields} */
        const fields = {};
        if (str(flags.title)) fields.title = str(flags.title);
        if (str(flags.kind)) fields.kind = attempt(() => sources.parseKind(/** @type {string} */ (str(flags.kind))));
        for (const k of /** @type {const} */ (['author', 'url', 'file', 'notes'])) {
          if (str(flags[k]) !== undefined) fields[k] = orNull(str(flags[k]));
        }
        if (str(flags.domain)) fields.domain = orNull(str(flags.domain)) === null ? null : domainRef(ctx, /** @type {string} */ (str(flags.domain)));
        for (const k of /** @type {const} */ (['started', 'finished'])) {
          if (str(flags[k]) !== undefined) fields[k] = attempt(() => tasks.parseDue(/** @type {string} */ (str(flags[k])), ctx.today));
        }
        if (!Object.keys(fields).length) fail('nothing to change: --title, --kind, --author, --url, --file, --domain, --notes, --started or --finished');
        ops = [{ type: 'edit', id, fields }];
        break;
      }
      case 'delete':
        if (!flags.yes) fail(`delete removes “${s.title}” with its notes and quotes for good. Add --yes to delete it.`);
        ops = [{ type: 'delete', id }];
        break;
      default:
        return fail(`unknown source action “${sub}” (compass help)`);
    }
  }
  const res = commitChange(ctx.cfg, ctx.cfg.sources, (raw) => {
    const before = raw ? sources.normalize(raw) : sources.emptyDoc(ctx.tz);
    const after = sources.applyOps(before, ops);
    if (sources.serialize(after) === sources.serialize(before)) return null;
    return { text: sources.serialize(after), message: sources.commitMessage(ops, before, after) };
  }, { sync: ctx.sync });
  report(res, ctx.sync);
  const saved = sources.normalize(readJsonIfExists(ctx.cfg, ctx.cfg.sources)).sources.find((x) => x.id === id);
  if (saved) console.log(sourceLine(saved));
}

/** What the commands on sealed files (cli/trades.mjs, cli/finance.mjs) borrow from here. @type {import('./sealed.mjs').Kit} */
const KIT = { fail, attempt, report, domainRef, needPassphrase: () => needPassphrase() };

/** The passphrase of this computer, or an error that says how to set it. */
function needPassphrase() {
  const pass = cryptSync.passphrase();
  if (!pass) fail('no encryption password on this computer. Store it (it asks for it) with:\n  secret-tool store --label="compass encryption" service compass key encryption');
  return pass;
}

/**
 * The journal as it is in the repo, opened.
 * @param {Ctx} ctx @param {string} pass
 * @returns {JournalDoc}
 */
function readJournal(ctx, pass) {
  const raw = readJsonIfExists(ctx.cfg, ctx.cfg.journal);
  if (!raw) return journal.emptyDoc(ctx.tz);
  if (!cryptSync.isSealed(raw)) fail(`${ctx.cfg.journal} is not sealed; the journal is only kept encrypted`);
  return journal.normalize(JSON.parse(attempt(() => cryptSync.openSync(raw, pass)).text));
}

/** @param {import('../lib/journal.js').Day} d */
function printDay(d) {
  console.log(`# ${d.date}`);
  if (d.text) console.log(d.text);
  for (const n of d.notes) console.log(`- ${n.text} [${n.id}]`);
  if (!d.text && !d.notes.length) console.log('(nothing written)');
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function journalCmd(ctx, sub, rest, flags) {
  const pass = needPassphrase();
  const doc = readJournal(ctx, pass);
  /** @param {string|undefined} raw */
  const day = (raw) => {
    if (!raw) return ctx.today;
    const text = raw.trim().toLowerCase();
    const back = /^-(\d+)$/.exec(text);
    const date = text === 'yesterday' ? addDays(ctx.today, -1) : back ? addDays(ctx.today, -Number(back[1])) : attempt(() => tasks.parseDue(text, ctx.today));
    if (!date) fail('which day? (today, yesterday, -N or YYYY-MM-DD)');
    if (date > ctx.today) fail(`${date} has not come yet`);
    return date;
  };
  /** @type {journal.Op[]} */
  let ops;
  switch (sub) {
    case undefined:
    case 'show':
      return printDay(journal.dayOf(doc, day(sub === 'show' ? rest[0] : undefined)));
    case 'days': {
      const n = str(flags.last) ? positive(/** @type {string} */ (str(flags.last)), '--last') : 7;
      const from = addDays(ctx.today, 1 - n);
      const list = doc.days.filter((d) => d.date >= from);
      if (!list.length) console.log(`Nothing written in the last ${n} days.`);
      list.forEach((d, i) => { if (i) console.log(''); printDay(d); });
      return;
    }
    case 'search': {
      const q = rest.join(' ').trim();
      if (!q) fail('search for what? compass journal search "word"');
      const list = journal.search(doc, q);
      if (!list.length) console.log('Nothing found.');
      list.forEach((d, i) => { if (i) console.log(''); printDay(d); });
      return;
    }
    case 'write': {
      const text = rest[0];
      if (text === undefined) fail('write what? compass journal write "text" [--date D] (replaces that day\'s text; "none" clears it)');
      ops = [{ type: 'setText', date: day(str(flags.date)), text: orNull(text) }];
      break;
    }
    case 'note': {
      const text = rest[0]?.trim();
      if (!text) fail('which note? compass journal note "text" [--date D]');
      ops = [{ type: 'addNote', date: day(str(flags.date)), note: journal.newNote(text, ctx.now) }];
      break;
    }
    case 'unnote': {
      const date = day(str(flags.date));
      if (!journal.dayOf(doc, date).notes.some((n) => n.id === rest[0])) fail(`${date} has no note ${rest[0] ?? '?'} (compass journal ${date})`);
      ops = [{ type: 'removeNote', date, id: /** @type {string} */ (rest[0]) }];
      break;
    }
    default:
      // A date on its own: show that day.
      if (/^(\d{4}-\d{2}-\d{2}|today|yesterday|-\d+)$/.test(sub)) return printDay(journal.dayOf(doc, day(sub)));
      return fail(`unknown journal action “${sub}” (compass help)`);
  }
  const res = commitChange(ctx.cfg, ctx.cfg.journal, (raw) => {
    let salt = null;
    let before = journal.emptyDoc(ctx.tz);
    if (raw) {
      if (!cryptSync.isSealed(raw)) fail(`${ctx.cfg.journal} is not sealed`);
      const opened = attempt(() => cryptSync.openSync(raw, pass));
      salt = opened.salt;
      before = journal.normalize(JSON.parse(opened.text));
    }
    const after = journal.applyOps(before, ops);
    if (journal.serialize(after) === journal.serialize(before)) return null;
    return { text: cryptSync.sealSync(journal.serialize(after), pass, salt), message: journal.commitMessage(ops) };
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
    if (!doc.categories.includes(category)) console.error(`note: new category “${category}”`);
    if (ctx.domains.domains.length && !domains.domainOfCategory(ctx.domains, category)) {
      console.error(`note: “${category}” is not a registered domain (see compass domains)`);
    }
    /** @type {Goal} */
    const g = {
      id: newId(), kind: 'goal', title, category, horizon,
      target, unit: target !== null ? str(flags.unit) ?? null : null, deadline,
      period: horizon === 'deadline' ? null : periodKey(horizon, now, tz),
      repo: str(flags.repo) ?? null, location: str(flags.location) ?? null, notes: str(flags.notes) ?? null,
      progress: 0, createdAt: now.toISOString(),
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
        build = (fresh) => (live(fresh), [{ type: 'inc', id, delta }]);
        break;
      }
      case 'set': {
        const value = Number(String(rest[1] ?? '').replace(',', '.'));
        if (rest[1] === undefined || !Number.isFinite(value) || value < 0) fail('goal set needs a value ≥ 0');
        build = (fresh) => (live(fresh), [{ type: 'set', id, value }]);
        break;
      }
      case 'done':
        build = (fresh) => {
          const cur = live(fresh);
          return [{ type: 'set', id, value: cur.target ?? 1 }];
        };
        break;
      case 'sub': {
        const q = String(rest[1] ?? '').toLowerCase();
        const matches = (g.subgoals ?? []).filter((s) => s.id === rest[1] || s.title.toLowerCase().includes(q));
        if (!q || matches.length !== 1) fail(matches.length ? 'that matches several sub-goals' : 'no sub-goal matches');
        const subId = matches[0].id;
        build = (fresh) => (live(fresh), [{ type: 'toggleSub', id, subId, done: !flags.undo }]);
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

// ---------------------------------------------------------------- events and their calendar copy

/**
 * One line per event: when, how far, domain, place, and whether its calendar copy is up to date (⇄) or not (⇢).
 * @param {Event} e @param {Ctx} ctx @param {{ domain?: boolean }} [opts]
 */
function eventLine(e, ctx, opts = {}) {
  const d = daysUntil(events.dayOf(e.start), ctx.today, 'UTC');
  const bits = [`${events.whenText(e)} (${events.isPast(e, ctx.today) ? 'over' : d <= 0 ? 'now' : relDays(d)})`];
  if (opts.domain !== false) bits.push(e.domain);
  if (e.location) bits.push(`@ ${e.location}`);
  if (e.notes) bits.push('notes');
  const t = calendar.target(ctx.domains, e.domain);
  if (t) bits.push(e.cal && events.sameFields(events.fieldsOf(e), e.cal.last) && e.cal.calendar === t.calendar ? '⇄' : '⇢ to sync');
  return `◷ [${e.id}] ${e.title} — ${bits.join(' · ')}`;
}

/**
 * @param {EventsDoc} doc @param {string | undefined} ref
 * @returns {Event}
 */
function findEvent(doc, ref) {
  if (!ref) fail('which event? (id or part of the title)');
  const byId = doc.events.find((e) => e.id === ref);
  if (byId) return byId;
  const q = ref.toLowerCase();
  const pool = doc.events.filter((e) => e.title.toLowerCase().includes(q));
  if (pool.length === 1) return pool[0];
  if (!pool.length) fail(`no event matches “${ref}”`);
  return fail(`“${ref}” matches several events:\n${pool.map((e) => `  [${e.id}] ${e.title} — ${events.whenText(e)}`).join('\n')}`);
}

/** @param {Ctx} ctx @param {Record<string, string | true>} flags */
function listEvents(ctx, flags) {
  const scope = scopeFrom(ctx, flags);
  if (scope.note && !scope.id) console.error(`note: ${scope.note}; listing every domain`);
  const own = scope.id ? domains.scope(ctx.domains, scope.id).own : null;
  const list = (flags.past ? [...ctx.events.events].sort(events.byStart) : events.upcoming(ctx.events, ctx.today))
    .filter((e) => !own || own.has(domains.canonical(ctx.domains, e.domain)));
  if (!list.length) console.log('No events.');
  for (const e of list) console.log(eventLine(e, ctx));
}

/**
 * A change to events.json and, in the same commit, to the tasks that move with an event.
 * @typedef {{ events: events.Op[], tasks?: import('../lib/tasks.js').Op[] }} EventPlan
 */

/**
 * Writes a plan built on the freshest versions of events.json and tasks.json.
 * @param {Ctx} ctx @param {(e: EventsDoc, t: TasksDoc) => EventPlan} build
 */
function writeEvents(ctx, build) {
  const { cfg } = ctx;
  return commitFiles(cfg, [cfg.events, cfg.tasks], (docs) => {
    const eBefore = docs[cfg.events] ? events.normalize(docs[cfg.events]) : events.emptyDoc(ctx.tz);
    const tBefore = docs[cfg.tasks] ? tasks.normalize(docs[cfg.tasks]) : tasks.emptyDoc(ctx.tz);
    const plan = build(eBefore, tBefore);
    /** @type {Record<string, string>} */
    const files = {};
    const messages = [];
    if (plan.events.length) {
      const after = events.applyOps(eBefore, plan.events);
      if (events.serialize(after) !== events.serialize(eBefore)) {
        files[cfg.events] = events.serialize(after);
        messages.push(events.commitMessage(plan.events, eBefore, after));
      }
    }
    if (plan.tasks?.length) {
      const after = tasks.applyOps(tBefore, plan.tasks);
      files[cfg.tasks] = tasks.serialize(after);
      messages.push(tasks.commitMessage(plan.tasks, tBefore, after));
    }
    return messages.length ? { files, message: messages.join('\n\n') } : null;
  }, { sync: ctx.sync });
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function event(ctx, sub, rest, flags) {
  /** @param {string} text */
  const day = (text) => attempt(() => tasks.parseDue(text, ctx.today));
  /** @type {string} */
  let id;
  /** @type {(e: EventsDoc, t: TasksDoc) => EventPlan} */
  let build;
  if (sub === 'add') {
    const title = rest[0] ?? str(flags.title);
    if (!title) fail('event add needs a title: compass event add "title" --domain D --date DATE');
    const scope = scopeFrom(ctx, flags);
    if (!scope.id) fail(scope.note ? `${scope.note}; use --domain` : 'an event needs a domain: --domain D (or --cwd PATH)');
    if (!str(flags.date)) fail('when? --date DATE [--time HH:MM[-HH:MM]] [--until DATE]');
    const when = attempt(() => events.parseWhen(day(/** @type {string} */ (str(flags.date))), orNull(str(flags.time)), str(flags.until) ? day(/** @type {string} */ (str(flags.until))) : null));
    const e = events.newEvent({ title, domain: /** @type {string} */ (scope.id), ...when, location: orNull(str(flags.location)), notes: orNull(str(flags.notes)) }, ctx.now);
    const calId = str(flags['cal-id']);
    if (calId) {
      const t = calendar.target(ctx.domains, e.domain);
      if (!t) fail(`“${e.domain}” has no calendar (compass domain edit <id> --calendar ID)`);
      e.cal = calendar.linkFor(e, calId, t.calendar);
    }
    id = e.id;
    build = () => ({ events: [{ type: 'add', event: e }] });
  } else {
    const e = findEvent(ctx.events, rest[0]);
    id = e.id;
    switch (sub) {
      case 'show': {
        console.log(eventLine(e, ctx));
        if (e.notes) console.log(e.notes.split('\n').map((l) => `  | ${l}`).join('\n'));
        const linked = ctx.tasks.tasks.filter((t) => t.event === e.id);
        for (const t of linked) console.log(`  ${taskLine(t, ctx)}`);
        if (e.cal) console.log(`  calendar copy: ${e.cal.id}`);
        return;
      }
      case 'delete':
        if (!flags.yes) fail(`delete removes “${e.title}” for good (and its calendar copy on the next sync). Add --yes to delete it.`);
        build = (_, t) => ({
          events: [{ type: 'delete', id }],
          tasks: t.tasks.filter((x) => x.event === id).map((x) => ({ type: 'edit', id: x.id, fields: { event: null } })),
        });
        break;
      case 'edit': {
        /** @type {events.EventFields} */
        const fields = {};
        if (str(flags.title)) fields.title = str(flags.title);
        if (str(flags.domain)) fields.domain = domainRef(ctx, /** @type {string} */ (str(flags.domain)));
        for (const k of /** @type {const} */ (['location', 'notes'])) if (str(flags[k]) !== undefined) fields[k] = orNull(str(flags[k]));
        const date = str(flags.date) === undefined ? undefined : day(/** @type {string} */ (str(flags.date)));
        const time = str(flags.time);
        const until = str(flags.until);
        if (date !== undefined && time === undefined && until === undefined) Object.assign(fields, events.moveTo(e, date));
        else if (date !== undefined || time !== undefined || until !== undefined) {
          const curTime = events.isAllDay(e.start) ? null : `${events.timeOf(e.start)}${e.end ? `-${events.timeOf(e.end)}` : ''}`;
          const curUntil = e.end && events.dayOf(e.end) !== events.dayOf(e.start) ? events.dayOf(e.end) : null;
          const u = until === undefined ? curUntil : orNull(until) === null ? null : day(until);
          Object.assign(fields, attempt(() => events.parseWhen(date ?? events.dayOf(e.start), time === undefined ? curTime : orNull(time), u)));
        }
        if (!Object.keys(fields).length) fail('nothing to edit');
        build = (ev, t) => {
          const cur = ev.events.find((x) => x.id === id);
          return { events: [{ type: 'edit', id, fields }], tasks: cur && fields.start ? events.tasksToMove(t, id, cur.start, fields.start) : [] };
        };
        break;
      }
      default:
        return fail(`unknown event action “${sub}” (compass help)`);
    }
  }
  const res = writeEvents(ctx, build);
  report(res, ctx.sync);
  const saved = events.normalize(readJsonIfExists(ctx.cfg, ctx.cfg.events)).events.find((x) => x.id === id);
  if (saved) console.log(eventLine(saved, { ...ctx, tasks: tasks.normalize(readJsonIfExists(ctx.cfg, ctx.cfg.tasks) ?? tasks.emptyDoc()) }));
}

/** What the calendar copy is missing, in a few words ('' = nothing). @param {Ctx} ctx */
function calendarPending(ctx) {
  const { push } = calendar.plan(ctx.events, ctx.domains);
  if (!push.length) return '';
  /** @type {Record<string, number>} */
  const n = {};
  for (const p of push) n[p.action] = (n[p.action] ?? 0) + 1;
  return `${push.length} to sync (${Object.entries(n).map(([a, k]) => `${k} ${a}`).join(', ')})`;
}

/** Reads JSON from a file or, with "-", from stdin. @param {string} from */
function readInput(from) {
  const text = from === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(from), 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${from === '-' ? 'stdin' : from} is not valid JSON`);
  }
}

/**
 * @param {Ctx} ctx @param {string | undefined} sub @param {string[]} rest
 * @param {Record<string, string | true>} flags
 */
function calendarCmd(ctx, sub, rest, flags) {
  switch (sub ?? 'status') {
    case 'status': {
      const pending = calendarPending(ctx);
      console.log(pending ? `Calendar: ${pending}.` : 'Calendar: nothing to push.');
      console.log(`Last read of the calendar: ${ctx.events.checkedAt ?? 'never'}.`);
      for (const p of calendar.plan(ctx.events, ctx.domains).push) {
        const e = p.event ? ctx.events.events.find((x) => x.id === p.event) : null;
        console.log(`  ${p.action} ${e ? `[${e.id}] ${e.title}` : `calendar copy ${'calId' in p ? p.calId : ''}`}`);
      }
      return;
    }
    case 'window':
      console.log(JSON.stringify(calendar.window(ctx.events, ctx.domains, ctx.today), null, 2));
      return;
    case 'sync': {
      const from = str(flags.remote);
      const remote = from ? readInput(from) : null;
      if (remote !== null && (typeof remote !== 'object' || Array.isArray(remote))) fail('--remote must be {"<calendar id>": [events…]}');
      const first = calendar.plan(ctx.events, ctx.domains, remote);
      if (first.pull.length || remote) {
        const res = writeEvents(ctx, (ev, t) => {
          const p = calendar.plan(ev, ctx.domains, remote);
          /** @type {events.Op[]} */
          const ops = [];
          /** @type {import('../lib/tasks.js').Op[]} */
          const tOps = [];
          for (const { event: eid, fields } of p.pull) {
            const cur = /** @type {Event} */ (ev.events.find((x) => x.id === eid));
            const { title, start, end, location } = fields;
            ops.push({ type: 'edit', id: eid, fields: { title, start, end, location } });
            ops.push({ type: 'link', id: eid, cal: { .../** @type {events.Link} */ (cur.cal), last: fields } });
            tOps.push(...events.tasksToMove(t, eid, cur.start, start));
          }
          if (remote) ops.push({ type: 'checked', at: ctx.now.toISOString() });
          return { events: ops, tasks: tOps };
        });
        if (res.message) console.error(res.message.split('\n\n').join(' · ') + (res.pushed ? '' : ' (not pushed yet)'));
      }
      const fresh = events.normalize(readJsonIfExists(ctx.cfg, ctx.cfg.events) ?? events.emptyDoc());
      const after = calendar.plan(fresh, ctx.domains, remote);
      console.log(JSON.stringify({ pulled: first.pull.map((p) => ({ event: p.event, title: p.title, fields: p.fields })), push: after.push, conflicts: after.conflicts }, null, 2));
      return;
    }
    case 'done': {
      const list = readInput(rest[0] ?? (flags.stdin ? '-' : str(flags.file) ?? '-'));
      if (!Array.isArray(list)) fail('done takes a list: [{"event": E, "calId": ID|null}, {"deleted": ID}]');
      const res = writeEvents(ctx, (ev) => {
        /** @type {events.Op[]} */
        const ops = [];
        for (const item of list) {
          if (typeof item?.deleted === 'string') {
            ops.push({ type: 'unremove', calId: item.deleted });
            continue;
          }
          const e = ev.events.find((x) => x.id === item?.event);
          if (!e) continue;
          const t = calendar.target(ctx.domains, e.domain);
          ops.push({ type: 'link', id: e.id, cal: item.calId && t ? calendar.linkFor(e, String(item.calId), t.calendar) : null });
        }
        return { events: ops };
      });
      report(res, ctx.sync);
      const pending = calendarPending({ ...ctx, events: events.normalize(readJsonIfExists(ctx.cfg, ctx.cfg.events) ?? events.emptyDoc()) });
      console.log(pending ? `Calendar: ${pending}.` : 'Calendar: in sync.');
      return;
    }
    default:
      return fail(`unknown calendar action “${sub}” (compass help)`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
