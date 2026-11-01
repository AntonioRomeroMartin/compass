// @ts-check
// The CLI's money commands: `compass trades|trade` (lib/trades.js) and `compass money` (lib/finance.js). Both
// files are sealed with the encryption password, like the journal; savings goals also touch goals.json (one commit).
// Trades come from the exchanges' APIs (later): `trade add` is there for scripts and tests.

import * as trades from '../lib/trades.js';
import * as finance from '../lib/finance.js';
import { normalize as normalizeGoals, applyOps as applyGoalOps, serialize as serializeGoals, emptyDoc as emptyGoals } from '../lib/goals.js';
import { periodKey } from '../lib/period.js';
import * as cryptSync from './crypt.mjs';
import { commitChange, commitFiles, readJsonIfExists } from './repo.mjs';

/**
 * What the main CLI lends these commands.
 * @typedef {Object} Kit
 * @property {(msg: string) => never} fail
 * @property {<T>(fn: () => T) => T} attempt
 * @property {(res: { pushed: boolean, message: string | null }, sync: boolean) => void} report
 * @property {(ctx: any, ref: string) => string} domainRef
 * @property {() => string} needPassphrase
 */

/** @typedef {Record<string, string | true>} Flags */
/** @typedef {import('./compass.mjs').Ctx} Ctx */

/** @param {string | true | undefined} v */
const str = (v) => (typeof v === 'string' ? v : undefined);
/** @param {string | undefined} v */
const isNone = (v) => v !== undefined && ['', 'none', 'no'].includes(v.trim().toLowerCase());

/** Two decimals, no trailing zeros. @param {number} n */
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
/** @param {number} n */
const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** @param {number|null} r */
const rText = (r) => (r === null ? '— R' : `${r > 0 ? '+' : ''}${fmt(Math.round(r * 100) / 100)} R`);
/** @param {number|null} x */
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/**
 * A sealed data file: read (opened) and written (sealed again with its salt), with one module's operations.
 * @template D, O
 * @param {Ctx} ctx @param {Kit} kit @param {string} rel @param {string} pass
 * @param {{ normalize: (raw: any) => D, emptyDoc: (tz?: string) => D, applyOps: (doc: D, ops: O[]) => D, serialize: (doc: D) => string, commitMessage: (ops: O[]) => string }} mod
 */
function sealedFile(ctx, kit, rel, pass, mod) {
  /** @param {any} raw @returns {{ doc: D, salt: string|null }} */
  const open = (raw) => {
    if (!raw) return { doc: mod.emptyDoc(ctx.tz), salt: null };
    if (!cryptSync.isSealed(raw)) kit.fail(`${rel} is not sealed; money is only kept encrypted`);
    const opened = kit.attempt(() => cryptSync.openSync(raw, pass));
    return { doc: mod.normalize(JSON.parse(opened.text)), salt: opened.salt };
  };
  return {
    read: () => open(readJsonIfExists(ctx.cfg, rel)).doc,
    open,
    /** @param {D} doc @param {string|null} salt */
    seal: (doc, salt) => cryptSync.sealSync(mod.serialize(doc), pass, salt),
    /** Applies the operations that `build` makes from the latest version, seals and commits. @param {(doc: D) => O[]} build */
    write(build) {
      const res = commitChange(ctx.cfg, rel, (raw) => {
        const { doc: before, salt } = open(raw);
        const ops = build(before);
        const after = mod.applyOps(before, ops);
        if (!ops.length || mod.serialize(after) === mod.serialize(before)) return null;
        return { text: cryptSync.sealSync(mod.serialize(after), pass, salt), message: mod.commitMessage(ops) };
      }, { sync: ctx.sync });
      kit.report(res, ctx.sync);
    },
  };
}

/** @param {Kit} kit @param {string|undefined} raw @param {string} what @param {{ positive?: boolean }} [opts] */
function number(kit, raw, what, opts = {}) {
  const n = Number(String(raw ?? '').replace(',', '.'));
  if (raw === undefined || raw === '' || !Number.isFinite(n) || (opts.positive && n <= 0)) kit.fail(`${what} must be a number${opts.positive ? ' greater than 0' : ''}`);
  return n;
}

/** @param {Kit} kit @param {string|undefined} raw @param {string} what */
function instant(kit, raw, what) {
  if (!raw || Number.isNaN(Date.parse(raw))) kit.fail(`${what} must be a date and time (2026-03-02T09:30:00Z)`);
  return new Date(/** @type {string} */ (raw)).toISOString();
}

// ---------------------------------------------------------------- trades

/** @param {trades.TradesDoc} doc @param {string|undefined} ref @param {Kit} kit */
function findTrade(doc, ref, kit) {
  if (!ref) return kit.fail('which trade? (its id, tr_…, or its symbol if only one is open)');
  const byId = doc.trades.find((t) => t.id === ref);
  if (byId) return byId;
  const open = doc.trades.filter((t) => !trades.isClosed(t) && t.symbol.toLowerCase() === ref.toLowerCase());
  if (open.length === 1) return open[0];
  return kit.fail(open.length ? `${open.length} open trades of ${ref}: use the id` : `no trade “${ref}” (compass trades)`);
}

/** @param {trades.TradesDoc} doc @param {trades.Trade} t @param {string} tz */
function tradeLine(doc, t, tz) {
  const closed = trades.isClosed(t);
  const errors = trades.errorsOf(doc, t, tz);
  return [
    `[${t.id}] ${periodKey('day', t.entryAt, tz)} ${t.symbol} ${t.side} ${trades.MARKET_TEXT[t.market]}`,
    closed ? `${rText(trades.rOf(t))} · ${money(/** @type {number} */ (t.pnl))} ${doc.currency}` : 'open',
    t.stop === null ? 'no stop' : null,
    t.setup && `${t.setup}${t.timeframe ? ` ${t.timeframe}` : ''}`,
    errors.length ? `errors: ${errors.join(', ')}` : closed ? 'clean' : null,
  ].filter(Boolean).join(' · ');
}

/** @param {trades.TradesDoc} doc @param {trades.Trade} t @param {string} tz */
function showTrade(doc, t, tz) {
  const rr = trades.plannedRR(t);
  console.log(tradeLine(doc, t, tz));
  /** @type {[string, unknown][]} */
  const rows = [
    ['account', t.account || null], ['size', t.qty], ['entry', `${t.entry} at ${t.entryAt}`], ['exit', t.exit === null ? null : `${t.exit} at ${t.exitAt}`],
    ['leverage', t.leverage], ['fees', t.fees || null], ['funding', t.funding || null], ['initial stop', t.stop],
    ['order stop', t.stop === null ? t.orderStop : null], ['risk', trades.risk(t)], ['target', t.target], ['planned R:R', rr === null ? null : fmt(rr)],
    ['emotion', t.emotion], ['notes', t.notes],
  ];
  for (const [k, v] of rows) if (v !== null && v !== undefined) console.log(`  ${k}: ${v}`);
}

/** @param {trades.Stats} s @param {string} cur */
const statsLine = (s, cur) => `${s.n} trades · win ${pct(s.winRate)} · expectancy ${rText(s.expectancy)} · total ${rText(s.totalR)} · ${money(s.pnl)} ${cur}`;

/**
 * compass trades [panel|limits|account|area] and compass trade <action>.
 * @param {Ctx} ctx @param {Kit} kit @param {'trades'|'trade'} cmd @param {string|undefined} sub @param {string[]} rest @param {Flags} flags
 */
export function tradesCmd(ctx, kit, cmd, sub, rest, flags) {
  const file = sealedFile(ctx, kit, ctx.cfg.trades, kit.needPassphrase(), trades);
  const doc = file.read();
  const tz = doc.timeZone ?? ctx.tz;
  const range = /** @type {trades.Range} */ (str(flags.range) ?? 'all');
  if (!trades.RANGES.includes(range)) kit.fail(`--range is one of ${trades.RANGES.join(', ')}`);

  if (cmd === 'trades') {
    switch (sub) {
      case undefined: {
        const list = flags.open ? doc.trades.filter((t) => !trades.isClosed(t)) : str(flags.range) ? trades.inRange(doc, range, ctx.now, tz) : doc.trades;
        if (!list.length) console.log('No trades.');
        for (const t of list) console.log(tradeLine(doc, t, tz));
        const hit = trades.limitsHitNow(doc, ctx.now, tz);
        if (hit.length) console.log(`LIMIT HIT (${hit.join(', ')}): no more trading today.`);
        return;
      }
      case 'panel': {
        const list = trades.inRange(doc, range, ctx.now, tz);
        const s = trades.stats(list);
        console.log(`# ${trades.RANGE_TEXT[range]}: ${statsLine(s, doc.currency)}`);
        console.log(`avg win ${rText(s.avgWin)} · avg loss ${rText(s.avgLoss)} · profit factor ${s.profitFactor === null ? '—' : fmt(Math.round(s.profitFactor * 100) / 100)} · max drawdown ${fmt(Math.round(s.maxDrawdown * 100) / 100)} R`);
        if (s.withR < s.n) console.log(`(${s.n - s.withR} without a stop: they count in PnL, not in R)`);
        for (const cut of trades.CUTS) {
          console.log(`\n## By ${trades.CUT_TEXT[cut].toLowerCase()}`);
          for (const b of trades.breakdown(list, cut)) console.log(`${b.key}: ${statsLine(b.stats, doc.currency)}`);
        }
        const d = trades.discipline(doc, list, tz);
        console.log('\n## Discipline');
        console.log(`clean: ${statsLine(d.clean, doc.currency)}`);
        console.log(`with errors: ${statsLine(d.flawed, doc.currency)}`);
        for (const e of d.errors) console.log(`  ${e.error}: ${e.n}`);
        return;
      }
      case 'limits': {
        /** @type {Partial<trades.Limits>} */
        const limits = {};
        for (const k of /** @type {const} */ (['day', 'week', 'streak'])) {
          const v = str(flags[k]);
          if (v === undefined) continue;
          limits[k] = isNone(v) ? null : k === 'streak' ? Math.round(number(kit, v, `--${k}`, { positive: true })) : number(kit, v, `--${k}`, { positive: true });
        }
        if (!Object.keys(limits).length) {
          const l = doc.limits;
          console.log(`day: ${l.day ?? '—'} R · week: ${l.week ?? '—'} R · losses in a row: ${l.streak ?? '—'}`);
          return;
        }
        return file.write(() => [{ type: 'setLimits', limits }]);
      }
      case 'account': {
        const id = rest[0];
        if (!id) return kit.fail('which account? compass trades account <id> --balance N --rate R [--name N]');
        const old = doc.accounts.find((a) => a.id === id);
        return file.write(() => [{ type: 'setAccount', account: {
          id, name: str(flags.name) ?? old?.name ?? id,
          balance: number(kit, str(flags.balance) ?? String(old?.balance ?? ''), '--balance'),
          rate: number(kit, str(flags.rate) ?? String(old?.rate ?? ''), '--rate (1 unit in EUR)', { positive: true }), at: ctx.now.toISOString(),
        } }]);
      }
      case 'area': {
        const ref = rest[0];
        if (!ref) return kit.fail('which area shows the trades? compass trades area <domain>');
        return file.write(() => [{ type: 'setDomain', domain: isNone(ref) ? null : kit.domainRef(ctx, ref) }]);
      }
      default:
        return kit.fail(`unknown trades action “${sub}” (compass help)`);
    }
  }

  switch (sub) {
    case 'show': {
      const t = findTrade(doc, rest[0], kit);
      return showTrade(doc, t, tz);
    }
    case 'add': {
      const market = /** @type {trades.Market} */ (str(flags.market) ?? 'spot');
      if (!(market in trades.MARKET_TEXT)) kit.fail('--market is spot, perp or stock');
      const side = str(flags.side) ?? 'long';
      if (side !== 'long' && side !== 'short') kit.fail('--side is long or short');
      const symbol = str(flags.symbol) ?? rest[0];
      if (!symbol) kit.fail('which symbol? compass trade add --symbol S --qty N --entry P --at TIME …');
      const exit = str(flags.exit);
      const opt = (/** @type {string} */ k) => (str(flags[k]) === undefined ? null : number(kit, str(flags[k]), `--${k}`));
      const t = trades.newTrade({
        symbol: /** @type {string} */ (symbol), market, side, account: str(flags.account) ?? '', extId: str(flags.ext) ?? null,
        qty: number(kit, str(flags.qty), '--qty', { positive: true }), entry: number(kit, str(flags.entry), '--entry', { positive: true }),
        entryAt: instant(kit, str(flags.at), '--at'), leverage: opt('leverage'), fees: opt('fees') ?? 0, funding: opt('funding') ?? 0,
        orderStop: opt('order-stop'),
        ...(exit === undefined ? {} : { exit: number(kit, exit, '--exit', { positive: true }), exitAt: instant(kit, str(flags['exit-at']), '--exit-at'), pnl: number(kit, str(flags.pnl), '--pnl (net)') }),
      });
      file.write(() => [{ type: 'add', trade: t }]);
      const saved = file.read().trades.find((x) => x.id === t.id);
      if (saved) console.log(tradeLine(file.read(), saved, tz));
      return;
    }
    case 'close': {
      const t = findTrade(doc, rest[0], kit);
      return file.write(() => [{ type: 'update', id: t.id, fields: {
        exit: number(kit, str(flags.exit), '--exit', { positive: true }), exitAt: instant(kit, str(flags.at) ?? ctx.now.toISOString(), '--at'),
        pnl: number(kit, str(flags.pnl), '--pnl (net)'),
      } }]);
    }
    case 'edit': {
      const t = findTrade(doc, rest[0], kit);
      /** @type {trades.HandFields} */
      const fields = {};
      // --stop-loss: `--stop` is a switch of other commands.
      for (const [k, flag] of /** @type {const} */ ([['stop', 'stop-loss'], ['target', 'target']])) {
        const v = str(flags[flag]);
        if (v !== undefined) fields[k] = isNone(v) ? null : number(kit, v, `--${flag}`, { positive: true });
      }
      for (const k of /** @type {const} */ (['setup', 'timeframe', 'notes'])) {
        const v = str(flags[k]);
        if (v !== undefined) fields[k] = isNone(v) ? null : v;
      }
      const emotion = str(flags.emotion);
      if (emotion !== undefined) {
        const n = Number(emotion);
        if (!isNone(emotion) && !(Number.isInteger(n) && n >= 1 && n <= 5)) kit.fail('--emotion is 1-5 or none');
        fields.emotion = isNone(emotion) ? null : n;
      }
      const errors = str(flags.errors);
      if (errors !== undefined) fields.errors = isNone(errors) ? [] : errors.split(',').map((e) => e.trim()).filter(Boolean);
      if (!Object.keys(fields).length) kit.fail('nothing to change: --stop-loss, --setup, --timeframe, --target, --emotion, --errors, --notes');
      return file.write(() => [{ type: 'edit', id: t.id, fields }]);
    }
    case 'delete': {
      const t = findTrade(doc, rest[0], kit);
      if (!flags.yes) kit.fail(`this deletes ${t.symbol} of ${periodKey('day', t.entryAt, tz)} for good: add --yes`);
      return file.write(() => [{ type: 'delete', id: t.id }]);
    }
    default:
      return kit.fail(`unknown trade action “${sub ?? ''}” (compass help)`);
  }
}

// ---------------------------------------------------------------- money

/** @param {finance.FinanceDoc} doc @param {string|undefined} ref @param {Kit} kit @param {{ transfer?: boolean }} [opts] */
function categoryRef(doc, ref, kit, opts = {}) {
  if (!ref) return kit.fail('which category?');
  if (opts.transfer && ref.toLowerCase() === finance.TRANSFER) return finance.TRANSFER;
  const c = doc.categories.find((x) => x.id === ref) ?? doc.categories.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  return c ? c.id : kit.fail(`no category “${ref}” (compass money categories)`);
}

/** A category id from its name. @param {string} name */
const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';

/** @param {finance.Movement} m @param {finance.FinanceDoc} doc */
const movementLine = (m, doc) => `[${m.id}] ${m.date} ${money(m.amount)} ${m.text}${m.account ? ` · ${m.account}` : ''} · ${finance.categoryOf(doc, m) ?? 'uncategorized'}`;

/**
 * compass money …: budget of a month, net worth, categories, rules, accounts, movements and savings goals.
 * @param {Ctx} ctx @param {Kit} kit @param {string|undefined} sub @param {string[]} rest @param {Flags} flags
 */
export function moneyCmd(ctx, kit, sub, rest, flags) {
  const pass = kit.needPassphrase();
  const file = sealedFile(ctx, kit, ctx.cfg.finance, pass, finance);
  const doc = file.read();
  const tradesDoc = sealedFile(ctx, kit, ctx.cfg.trades, pass, trades).read();
  const worth = () => finance.netWorth(file.read(), trades.accountsInEur(tradesDoc));
  const month = ctx.today.slice(0, 7);
  /** @param {string|undefined} raw */
  const monthOf = (raw) => {
    if (!raw) return month;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) kit.fail('a month is YYYY-MM');
    return /** @type {string} */ (raw);
  };

  switch (sub) {
    case undefined:
    case 'show':
    default: {
      if (sub && sub !== 'show' && !/^\d{4}-\d{2}$/.test(sub)) return kit.fail(`unknown money action “${sub}” (compass help)`);
      const b = finance.budget(doc, monthOf(sub === 'show' ? rest[0] : sub));
      console.log(`# ${b.month}: spent ${money(b.spent)} of ${money(b.limit)} · income ${money(b.income)} · expenses ${money(b.expenses)}${b.avgExpenses === null ? '' : ` (average ${money(b.avgExpenses)})`} · saved ${money(b.saved)}`);
      for (const c of b.categories) console.log(`${c.name}: ${money(c.spent)}${c.limit === null ? '' : ` of ${money(c.limit)}`}${c.avg === null ? '' : ` · average ${money(c.avg)}`}`);
      if (b.uncategorized.length) console.log(`${b.uncategorized.length} uncategorized (compass money uncategorized)`);
      const w = worth();
      console.log(`\nNet worth: ${money(w.total)} EUR (${Object.entries(w.byKind).map(([k, v]) => `${k} ${money(v)}`).join(' · ') || 'no accounts'})`);
      return;
    }
    case 'uncategorized': {
      const list = finance.budget(doc, monthOf(rest[0])).uncategorized;
      if (!list.length) console.log('Nothing uncategorized.');
      for (const m of list) console.log(movementLine(m, doc));
      return;
    }
    case 'movements': {
      const m = monthOf(rest[0]);
      for (const x of doc.movements.filter((y) => y.date.startsWith(m))) console.log(movementLine(x, doc));
      return;
    }
    case 'categories': {
      if (!doc.categories.length) console.log('No categories yet (compass money category add "name" --limit N).');
      for (const c of doc.categories) console.log(`${c.id}: ${c.name} · limit ${finance.limitIn(c, month) ?? '—'}`);
      for (const r of doc.rules) console.log(`rule [${r.id}] “${r.match}” → ${r.category}`);
      return;
    }
    case 'category': {
      const [action, ref, value] = rest;
      if (action === 'add') {
        const name = ref?.trim();
        if (!name) return kit.fail('which name? compass money category add "name" [--limit N]');
        let id = slug(name);
        while (doc.categories.some((c) => c.id === id) || id === finance.TRANSFER) id += '-2';
        const limit = str(flags.limit);
        return file.write(() => [{ type: 'addCategory', category: { id, name, limits: limit === undefined ? [] : [{ from: month, amount: number(kit, limit, '--limit', { positive: true }) }] } }]);
      }
      const id = categoryRef(doc, ref, kit);
      if (action === 'limit') return file.write(() => [{ type: 'setLimit', id, from: monthOf(str(flags.from)), amount: isNone(value) ? null : number(kit, value, 'the limit', { positive: true }) }]);
      if (action === 'rename') return file.write(() => [{ type: 'renameCategory', id, name: value ?? kit.fail('which new name?') }]);
      if (action === 'remove') {
        if (!flags.yes) kit.fail('its movements become uncategorized and its rules go: add --yes');
        return file.write(() => [{ type: 'removeCategory', id }]);
      }
      return kit.fail('compass money category add|limit|rename|remove …');
    }
    case 'rule': {
      const [action, a, b] = rest;
      if (action === 'add') {
        if (!a?.trim()) kit.fail('compass money rule add "text in the movement" <category|transfer>');
        return file.write(() => [{ type: 'addRule', rule: { id: finance.newId('r_'), match: a.trim(), category: categoryRef(doc, b, kit, { transfer: true }) } }]);
      }
      if (action === 'remove') {
        if (!doc.rules.some((r) => r.id === a)) kit.fail(`no rule “${a ?? ''}” (compass money categories)`);
        return file.write(() => [{ type: 'removeRule', id: /** @type {string} */ (a) }]);
      }
      return kit.fail('compass money rule add|remove …');
    }
    case 'account': {
      const [action, id] = rest;
      if (!id) return kit.fail('compass money account set <id> --kind K --balance N [--currency C --rate R --name N --address A] | remove <id>');
      if (action === 'remove') return file.write(() => [{ type: 'removeAccount', id }]);
      if (action !== 'set') return kit.fail('compass money account set|remove <id>');
      const old = doc.accounts.find((x) => x.id === id);
      const kind = /** @type {finance.Kind} */ (str(flags.kind) ?? old?.kind ?? 'bank');
      if (!(kind in finance.KIND_TEXT)) kit.fail(`--kind is one of ${Object.keys(finance.KIND_TEXT).join(', ')}`);
      const currency = (str(flags.currency) ?? old?.currency ?? 'EUR').toUpperCase();
      const rate = str(flags.rate);
      if (currency !== 'EUR' && rate === undefined && !old?.rate) kit.fail('--rate is needed for other currencies (1 unit in EUR)');
      return file.write(() => [{ type: 'setAccount', account: {
        id, name: str(flags.name) ?? old?.name ?? id, kind, currency,
        balance: str(flags.balance) === undefined ? old?.balance ?? null : number(kit, str(flags.balance), '--balance'),
        rate: currency === 'EUR' ? 1 : rate === undefined ? old?.rate ?? null : number(kit, rate, '--rate', { positive: true }),
        at: ctx.now.toISOString(), address: str(flags.address) ?? old?.address ?? null,
      } }]);
    }
    case 'add': {
      const date = str(flags.date) ?? ctx.today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) kit.fail('--date is YYYY-MM-DD');
      const text = str(flags.text) ?? rest[0];
      if (!text) kit.fail('compass money add --amount N --text T [--date D] [--account A] [--category C] [--ext ID]');
      const category = str(flags.category);
      return file.write(() => [{ type: 'addMovement', movement: {
        id: finance.newId('m_'), extId: str(flags.ext) ?? null, account: str(flags.account) ?? '', date,
        amount: number(kit, str(flags.amount), '--amount (− for out)'), text: /** @type {string} */ (text),
        category: category === undefined ? null : categoryRef(doc, category, kit, { transfer: true }),
      } }]);
    }
    case 'categorize': {
      const [id, cat] = rest;
      if (!doc.movements.some((m) => m.id === id)) kit.fail(`no movement “${id ?? ''}” (compass money uncategorized)`);
      return file.write(() => [{ type: 'categorize', id: /** @type {string} */ (id), category: isNone(cat) ? null : categoryRef(doc, cat, kit, { transfer: true }) }]);
    }
    case 'close': {
      // The row of a month: net worth when it is closed (default: last month, closed at the start of this one).
      const m = monthOf(rest[0] ?? finance.prevMonth(month));
      const w = worth();
      return file.write(() => [{ type: 'closeMonth', row: { month: m, total: w.total, byKind: w.byKind } }]);
    }
    case 'history': {
      if (!doc.months.length) console.log('No closed months yet (compass money close).');
      for (const r of doc.months) console.log(`${r.month}: ${money(r.total)} (${Object.entries(r.byKind).map(([k, v]) => `${k} ${money(v)}`).join(' · ')})`);
      return;
    }
    case 'saving': {
      // A goal whose progress is the net worth (networth) or what it grew since now (saved), up to a target.
      const [ref, kindRaw, targetRaw] = rest;
      const goals = normalizeGoals(readJsonIfExists(ctx.cfg, ctx.cfg.goals) ?? emptyGoals());
      const g = goals.goals.find((x) => x.id === ref) ?? goals.goals.find((x) => ref && x.title.toLowerCase().includes(ref.toLowerCase()));
      if (!g) return kit.fail('compass money saving <goal> networth|saved <target> | <goal> none');
      const off = isNone(kindRaw);
      if (!off && kindRaw !== 'networth' && kindRaw !== 'saved') kit.fail('the kind is networth (reach a net worth) or saved (grow it from now)');
      const kind = /** @type {'networth'|'saved'} */ (kindRaw);
      const target = off ? 0 : number(kit, targetRaw, 'the target', { positive: true });
      const base = worth().total;
      const res = commitFiles(ctx.cfg, [ctx.cfg.finance, ctx.cfg.goals], (docs) => {
        const { doc: before, salt } = file.open(docs[ctx.cfg.finance]);
        /** @type {finance.Op[]} */
        const ops = off ? [{ type: 'removeSaving', goal: g.id }] : [{ type: 'setSaving', saving: { goal: g.id, kind, target, base: kind === 'saved' ? base : null } }];
        const gBefore = normalizeGoals(docs[ctx.cfg.goals] ?? emptyGoals());
        const gAfter = applyGoalOps(gBefore, [{ type: 'edit', id: g.id, fields: { source: off ? null : 'savings', target: null } }]);
        return {
          files: { [ctx.cfg.finance]: file.seal(finance.applyOps(before, ops), salt), [ctx.cfg.goals]: serializeGoals(gAfter) },
          message: `goals: “${g.title}” ${off ? 'counted by hand' : 'counted from net worth'}`,
        };
      }, { sync: ctx.sync });
      return kit.report(res, ctx.sync);
    }
    case 'area': {
      const ref = rest[0];
      if (!ref) return kit.fail('which area shows the budget? compass money area <domain>');
      return file.write(() => [{ type: 'setDomain', domain: isNone(ref) ? null : kit.domainRef(ctx, ref) }]);
    }
  }
}
