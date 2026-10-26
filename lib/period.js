// @ts-check
// Period keys of the goals, computed in an explicit IANA time zone
// (the `timeZone` field of goals.json), never the device's by accident.
// Used by the app and the CLI (`compass period`).

/** @typedef {'day'|'week'|'month'|'quarter'|'year'|'deadline'} Horizon */
/** @typedef {{ y: number, m: number, d: number }} CivilDate */

/** @type {Horizon[]} */
export const HORIZONS = ['day', 'week', 'month', 'quarter', 'year', 'deadline'];

const DAY_MS = 86400000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Device time zone (only as a default when creating a new file). */
export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Is it a valid IANA zone?
 * @param {unknown} tz
 * @returns {tz is string}
 */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/** @param {string} tz */
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/**
 * Civil date (year, month, day) in zone `tz`.
 * A `YYYY-MM-DD` string is interpreted directly as that civil day.
 * @param {Date | string} when
 * @param {string} tz
 * @returns {CivilDate}
 */
export function civilDate(when, tz) {
  if (typeof when === 'string') {
    const match = DATE_ONLY.exec(when);
    if (match) return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
    when = new Date(when);
  }
  if (Number.isNaN(when.getTime())) throw new Error('Invalid date');
  /** @type {Record<string, string>} */
  const parts = {};
  for (const p of formatter(tz).formatToParts(when)) parts[p.type] = p.value;
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * ISO 8601 week of a civil date.
 * @param {CivilDate} c
 * @returns {{ year: number, week: number }}
 */
export function isoWeek({ y, m, d }) {
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // lunes = 0
  const thursday = new Date(t + (3 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return { year, week };
}

/**
 * Period key for a horizon.
 * @param {Horizon} horizon
 * @param {Date | string} when
 * @param {string} tz
 * @returns {string}
 */
export function periodKey(horizon, when, tz) {
  const c = civilDate(when, tz);
  switch (horizon) {
    case 'day':
      return `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;
    case 'week': {
      const w = isoWeek(c);
      return `${w.year}-W${pad2(w.week)}`;
    }
    case 'month':
      return `${c.y}-${pad2(c.m)}`;
    case 'quarter':
      return `${c.y}-Q${Math.ceil(c.m / 3)}`;
    case 'year':
      return String(c.y);
    case 'deadline':
      return 'once';
    default:
      throw new Error(`Unknown horizon: ${horizon}`);
  }
}

/**
 * All period keys for an instant.
 * @param {Date | string} when
 * @param {string} tz
 * @returns {Record<Horizon, string>}
 */
export function periodKeys(when, tz) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const h of HORIZONS) out[h] = periodKey(h, when, tz);
  return /** @type {Record<Horizon, string>} */ (out);
}

/**
 * Civil days (in `tz`) from `when` until `deadline` (`YYYY-MM-DD`).
 * 0 = hoy, negativo = vencido.
 * @param {string} deadline
 * @param {Date | string} when
 * @param {string} tz
 * @returns {number}
 */
export function daysUntil(deadline, when, tz) {
  const a = civilDate(when, tz);
  const b = civilDate(deadline, tz);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/**
 * Civil date as `YYYY-MM-DD`.
 * @param {CivilDate} c
 */
export function formatDate({ y, m, d }) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Is it a real `YYYY-MM-DD` date (not 2026-02-30)?
 * @param {unknown} s
 * @returns {s is string}
 */
export function isDate(s) {
  if (typeof s !== 'string') return false;
  const match = DATE_ONLY.exec(s);
  if (!match) return false;
  const t = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return t.getUTCFullYear() === Number(match[1]) && t.getUTCMonth() === Number(match[2]) - 1 && t.getUTCDate() === Number(match[3]);
}

/**
 * Adds `n` civil days to a `YYYY-MM-DD` date (no time zone involved).
 * @param {string} date
 * @param {number} n
 */
export function addDays(date, n) {
  const { y, m, d } = civilDate(date, 'UTC');
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return formatDate({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/**
 * ISO weekday of a `YYYY-MM-DD` date: 1 = Monday … 7 = Sunday.
 * @param {string} date
 */
export function isoWeekday(date) {
  const { y, m, d } = civilDate(date, 'UTC');
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

/**
 * Last day (Sunday) of the ISO week of a `YYYY-MM-DD` date.
 * @param {string} date
 */
export function endOfWeek(date) {
  return addDays(date, 7 - isoWeekday(date));
}

/**
 * Number of days in a month.
 * @param {number} y
 * @param {number} m  1-12
 */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
