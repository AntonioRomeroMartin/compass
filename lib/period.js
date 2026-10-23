// @ts-check
// Claves de periodo de los objetivos, calculadas en una zona horaria IANA explícita
// (la del campo `timeZone` de goals.json), nunca en la del dispositivo por accidente.
// Lo usan la app y la CLI (`compass period`).

/** @typedef {'day'|'week'|'month'|'quarter'|'year'|'deadline'} Horizon */
/** @typedef {{ y: number, m: number, d: number }} CivilDate */

/** @type {Horizon[]} */
export const HORIZONS = ['day', 'week', 'month', 'quarter', 'year', 'deadline'];

const DAY_MS = 86400000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Zona horaria del dispositivo (solo como valor por defecto al crear un archivo nuevo). */
export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * ¿Es una zona IANA válida?
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
 * Fecha civil (año, mes, día) en la zona `tz`.
 * Un string `YYYY-MM-DD` se interpreta directamente como ese día civil.
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
 * Semana ISO 8601 de una fecha civil.
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
 * Clave de periodo para un horizonte.
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
 * Todas las claves de periodo para un instante.
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
 * Días civiles (en `tz`) desde `when` hasta `deadline` (`YYYY-MM-DD`).
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
