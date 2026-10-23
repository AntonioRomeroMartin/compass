#!/usr/bin/env node
// @ts-check
// CLI de compass: la usa el agente (y quien quiera) para leer y cambiar los datos sin editar
// el JSON a mano. Comparte la lógica con la app (`lib/`) y escribe con operaciones, igual que ella.

import { HORIZONS, daysUntil, isValidTimeZone, periodKey, periodKeys } from '../lib/period.js';
import { applyOps, commitMessage, goalKey, isDone, isExpired, newId, normalize, serialize, subgoalsDone } from '../lib/goals.js';
import { commitChange, loadConfig, pull, readJson } from './repo.mjs';

/** @typedef {import('../lib/goals.js').Goal} Goal */
/** @typedef {import('../lib/goals.js').GoalsDoc} GoalsDoc */
/** @typedef {import('../lib/goals.js').Op} Op */
/** @typedef {import('../lib/period.js').Horizon} Horizon */

const HELP = `compass — goals (and soon tasks, journal…) from the command line

Usage:
  compass today                         goals for today and this week, deadlines within 7 days
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

<goal> is an id (g_…) or part of the title. --no-sync skips git pull/push.
Config: ~/.config/compass/config.json → {"repo": "<data repo checkout>", "goals": "goals.json"}`;

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
      if (next !== undefined && !next.startsWith('--')) flags[name] = argv[++i];
      else flags[name] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/** @param {string | true | undefined} v */
const str = (v) => (typeof v === 'string' ? v : undefined);

/** @param {string} msg */
function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** @param {number} n */
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/**
 * Una línea por objetivo, compacta (es lo que lee el agente).
 * @param {Goal} g @param {Date} now @param {string} tz
 */
function goalLine(g, now, tz) {
  const key = goalKey(g, now, tz);
  const value = g.progress[key] ?? 0;
  const done = isDone(g, key);
  const progress = g.target ? `${fmt(value)}/${fmt(g.target)}${g.unit ? ` ${g.unit}` : ''}` : done ? 'done' : 'not done';
  const bits = [progress, g.horizon === 'deadline' ? `due ${g.deadline} (${dueText(g, now, tz)})` : `${g.horizon}${g.repeat ? ' · habit' : ''}`, g.category];
  if (g.subgoals?.length) bits.push(`sub ${subgoalsDone(g, key)}/${g.subgoals.length}`);
  if (g.location) bits.push(`@ ${g.location}`);
  return `${done ? '✓' : '·'} [${g.id}] ${g.title} — ${bits.join(' · ')}`;
}

/** @param {Goal} g @param {Date} now @param {string} tz */
function dueText(g, now, tz) {
  const d = daysUntil(/** @type {string} */ (g.deadline), now, tz);
  return d < 0 ? `${-d} d late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} d`;
}

/**
 * @param {GoalsDoc} doc @param {string | undefined} ref
 * @returns {Goal}
 */
function findGoal(doc, ref) {
  if (!ref) fail('which goal? (id or part of the title)');
  const r = /** @type {string} */ (ref);
  const byId = doc.goals.find((g) => g.id === r);
  if (byId) return byId;
  const q = r.toLowerCase();
  const live = doc.goals.filter((g) => !g.archived && g.title.toLowerCase().includes(q));
  const pool = live.length ? live : doc.goals.filter((g) => g.title.toLowerCase().includes(q));
  if (pool.length === 1) return pool[0];
  if (!pool.length) fail(`no goal matches “${r}”`);
  fail(`“${r}” matches several goals:\n${pool.map((g) => `  [${g.id}] ${g.title}`).join('\n')}`);
  throw new Error('unreachable');
}

/** @param {string} raw @param {string} what */
function positive(raw, what) {
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) fail(`${what} must be a number greater than 0`);
  return n;
}

/** @param {GoalsDoc} doc */
function zoneOf(doc) {
  const tz = doc.timeZone;
  if (!isValidTimeZone(tz)) fail('goals.json has no valid "timeZone"');
  return /** @type {string} */ (tz);
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
    if (!tz) tz = readJson(cfg, cfg.goals).timeZone;
    if (!isValidTimeZone(tz)) fail('no valid time zone: use --tz Area/City or set "timeZone" in goals.json');
    const when = sub ?? now;
    const until = str(flags.days) ?? str(flags.dias);
    if (until) console.log(daysUntil(until, when, /** @type {string} */ (tz)));
    else console.log(JSON.stringify({ timeZone: tz, ...periodKeys(when, /** @type {string} */ (tz)) }, null, 2));
    return;
  }

  if (sync) pull(cfg);
  /** @type {GoalsDoc} */
  const doc = normalize(readJson(cfg, cfg.goals));
  const tz = zoneOf(doc);

  if (cmd === 'today') {
    const keys = periodKeys(now, tz);
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(now);
    console.log(`Today · ${date} · ${keys.week} (${tz})`);
    const live = doc.goals.filter((g) => !g.archived && !isExpired(g, now, tz));
    const pick = live.filter((g) =>
      g.horizon === 'day' || g.horizon === 'week' ||
      (g.horizon === 'deadline' && !!g.deadline && daysUntil(g.deadline, now, tz) <= 7));
    console.log(pick.length ? `Goals (${pick.length} of ${live.length} active)` : `Goals: nothing for today or this week (${live.length} active)`);
    for (const g of pick) console.log('  ' + goalLine(g, now, tz));
    return;
  }

  if (cmd === 'goals') {
    const cat = str(flags.category);
    const list = doc.goals.filter((g) => {
      if (cat && g.category !== cat) return false;
      if (flags.all) return true;
      if (flags.archived) return !!g.archived;
      if (flags.past) return !g.archived && isExpired(g, now, tz);
      return !g.archived && !isExpired(g, now, tz);
    });
    if (!list.length) console.log('No goals.');
    for (const g of list) console.log(goalLine(g, now, tz));
    return;
  }

  if (cmd !== 'goal') fail(`unknown command “${cmd}” (compass help)`);

  /** @type {(fresh: GoalsDoc) => Op[]} */
  let build;
  if (sub === 'add') {
    const title = str(flags.title);
    const category = str(flags.category);
    const horizon = /** @type {Horizon} */ (str(flags.horizon));
    if (!title || !category || !horizon) fail('goal add needs --title, --category and --horizon');
    if (!HORIZONS.includes(horizon)) fail(`--horizon must be one of ${HORIZONS.join(', ')}`);
    const target = str(flags.target) ? positive(/** @type {string} */ (str(flags.target)), '--target') : null;
    const deadline = horizon === 'deadline' ? str(flags.deadline) ?? null : null;
    if (horizon === 'deadline' && !/^\d{4}-\d{2}-\d{2}$/.test(deadline ?? '')) fail('a deadline goal needs --deadline YYYY-MM-DD');
    const repeat = horizon !== 'deadline' && !!flags.repeat;
    if (!doc.categories.includes(/** @type {string} */ (category))) console.error(`note: new category “${category}”`);
    /** @type {Goal} */
    const goal = {
      id: newId(), kind: 'goal', title: /** @type {string} */ (title), category: /** @type {string} */ (category), horizon,
      target, unit: target !== null ? str(flags.unit) ?? null : null, deadline, repeat,
      period: repeat || horizon === 'deadline' ? null : periodKey(horizon, now, tz),
      repo: str(flags.repo) ?? null, location: str(flags.location) ?? null, notes: str(flags.notes) ?? null,
      progress: {}, createdAt: now.toISOString(),
    };
    build = () => [{ type: 'add', goal }];
  } else {
    const g = findGoal(doc, rest[0]);
    const id = g.id;
    /** @param {GoalsDoc} fresh */
    const live = (fresh) => {
      const cur = fresh.goals.find((x) => x.id === id);
      if (!cur) fail('the goal no longer exists');
      if (isExpired(/** @type {Goal} */ (cur), now, tz)) fail('the goal has expired (it is in Past); create a new one for this period');
      return /** @type {Goal} */ (cur);
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
        fail(`unknown goal action “${sub}” (compass help)`);
        return;
    }
  }

  const res = commitChange(cfg, cfg.goals, (raw) => {
    const before = normalize(raw);
    const ops = build(before);
    const after = applyOps(before, ops);
    return { text: serialize(after), message: commitMessage(ops, before, after) };
  }, { sync });
  if (!res.message) {
    console.log('No change.');
    return;
  }
  console.log(`${res.message}${res.pushed ? '' : sync ? ' (not pushed yet)' : ' (committed, not pushed: --no-sync)'}`);
  const fresh = normalize(readJson(cfg, cfg.goals));
  const g = sub === 'add' ? fresh.goals[fresh.goals.length - 1] : fresh.goals.find((x) => x.id === findGoal(doc, rest[0]).id);
  if (g) console.log(goalLine(g, now, tz));
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
