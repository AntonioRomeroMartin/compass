// @ts-check
// The CLI's finance commands: `compass money` (lib/finance.js): budget, net worth, categories, rules, accounts,
// movements and savings goals. The file is sealed with the encryption password, like the journal; savings goals
// also touch goals.json (one commit). Movements come from the bank (later): `money add` is there for scripts and tests.

import * as finance from '../lib/finance.js';
import { normalize as normalizeGoals, applyOps as applyGoalOps, serialize as serializeGoals, emptyDoc as emptyGoals } from '../lib/goals.js';
import { commitFiles, readJsonIfExists } from './repo.mjs';
import { isNone, money, number, sealedFile, str } from './sealed.mjs';

/** @typedef {import('./sealed.mjs').Kit} Kit */
/** @typedef {import('./sealed.mjs').Flags} Flags */
/** @typedef {import('./compass.mjs').Ctx} Ctx */

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
  // Last month's row of net worth, the first time finance is opened this month (as in the app).
  const due = finance.dueClose(file.read(), ctx.today.slice(0, 7));
  if (due) file.write((d) => {
    const op = finance.dueClose(d, ctx.today.slice(0, 7));
    return op ? [op] : [];
  });
  const doc = file.read();
  const worth = () => finance.netWorth(file.read());
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
