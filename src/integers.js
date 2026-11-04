// Checked integer arithmetic. Pure, isomorphic ESM.

export class OverflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OverflowError';
    this.code = code;
  }
}

/**
 * Add b to a only when both are safe integers, b is non-negative and the sum stays safe.
 * Returns { ok: true, value } or { ok: false, code: 'INTEGER_OVERFLOW', message }.
 */
export function checkedAdd(a, b) {
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    b < 0 ||
    b > Number.MAX_SAFE_INTEGER - a
  ) {
    return {
      ok: false,
      code: 'INTEGER_OVERFLOW',
      message: `cannot add ${String(b)} to ${String(a)} within the safe integer range`,
    };
  }
  return { ok: true, value: a + b };
}

/** a - b where both are safe integers and a >= b (non-negative result). */
export function checkedDifference(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b > a) {
    return {
      ok: false,
      code: 'INTEGER_UNDERFLOW',
      message: `cannot subtract ${String(b)} from ${String(a)} as a non-negative safe integer`,
    };
  }
  return { ok: true, value: a - b };
}

export function addOrThrow(a, b) {
  const r = checkedAdd(a, b);
  if (!r.ok) throw new OverflowError(r.code, r.message);
  return r.value;
}

export function differenceOrThrow(a, b) {
  const r = checkedDifference(a, b);
  if (!r.ok) throw new OverflowError(r.code, r.message);
  return r.value;
}

export function isNonNegativeSafeInteger(n) {
  return Number.isSafeInteger(n) && n >= 0;
}
