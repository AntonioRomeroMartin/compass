// @ts-check
// What the CLI's commands on sealed files (trades, finance) share: the kit the main CLI lends them, reading and
// writing a file sealed with the encryption password, and parsing numbers.

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
export const str = (v) => (typeof v === 'string' ? v : undefined);
/** @param {string | undefined} v */
export const isNone = (v) => v !== undefined && ['', 'none', 'no'].includes(v.trim().toLowerCase());

/** Two decimals, no trailing zeros. @param {number} n */
export const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
/** @param {number} n */
export const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A sealed data file: read (opened) and written (sealed again with its salt), with one module's operations.
 * @template D, O
 * @param {Ctx} ctx @param {Kit} kit @param {string} rel @param {string} pass
 * @param {{ normalize: (raw: any) => D, emptyDoc: (tz?: string) => D, applyOps: (doc: D, ops: O[]) => D, serialize: (doc: D) => string, commitMessage: (ops: O[]) => string }} mod
 */
export function sealedFile(ctx, kit, rel, pass, mod) {
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
export function number(kit, raw, what, opts = {}) {
  const n = Number(String(raw ?? '').replace(',', '.'));
  if (raw === undefined || raw === '' || !Number.isFinite(n) || (opts.positive && n <= 0)) kit.fail(`${what} must be a number${opts.positive ? ' greater than 0' : ''}`);
  return n;
}
