// @ts-check
// The CLI's trades commands: `compass trades|trade` (lib/trades.js). The file is sealed with the encryption
// password, like the journal. Trades come from the exchanges' APIs (later): `trade add` is there for scripts and tests.

import * as trades from '../lib/trades.js';
import { periodKey } from '../lib/period.js';
import * as cryptSync from './crypt.mjs';
import { commitChange, readJsonIfExists } from './repo.mjs';

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
    if (!cryptSync.isSealed(raw)) kit.fail(`${rel} is not sealed; trades are only kept encrypted`);
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
 * compass trades [panel|limits|area] and compass trade <action>.
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
