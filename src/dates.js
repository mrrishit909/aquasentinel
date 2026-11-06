// Strict UTC timestamp helpers. Pure, isomorphic ESM: no node: imports, no local time zone.
// Format: YYYY-MM-DDTHH:MM:SSZ only. Offsets, fractional seconds and missing Z are rejected.

export const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * Parse a strict UTC timestamp into epoch seconds (a safe integer).
 * Returns null for anything that is not a real calendar instant in the exact format.
 */
export function parseUtcTimestamp(text) {
  if (typeof text !== 'string') return null;
  const m = TIMESTAMP_PATTERN.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (year < 100 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  if (!Number.isFinite(ms)) return null;
  // Round trip through UTC accessors: the components must reproduce the input exactly.
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  const seconds = ms / 1000;
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/** Format epoch seconds back into the strict UTC format. */
export function formatUtcTimestamp(epochSeconds) {
  if (!Number.isSafeInteger(epochSeconds)) throw new TypeError('epochSeconds must be a safe integer');
  const d = new Date(epochSeconds * 1000);
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}T${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}Z`;
}
