// Strict, atomic input validation for schemaVersion aqua-demo-1. Pure, isomorphic ESM.
// parseInput(text) -> size check -> JSON.parse -> depth check -> validate ->
//   { ok: true, data } | { ok: false, errors: [{ code, path, message }] }
// Any error means no data is returned at all (no partial findings, no partial totals).

import { parseUtcTimestamp } from './dates.js';

export const SCHEMA_VERSION = 'aqua-demo-1';
export const RULE_VERSION = 'aqua-review-1';

export const LIMITS = Object.freeze({
  maxInputBytes: 1024 * 1024, // 1 MiB of UTF-8
  maxAssets: 1000,
  maxApprovals: 2000,
  maxObservations: 5000,
  maxIdentifierLength: 200,
  maxNoteLength: 2000,
  maxDepth: 8,
  maxExportBytes: 10 * 1024 * 1024, // 10 MiB
});

export const ERROR_CODES = Object.freeze([
  'INPUT_NOT_TEXT',
  'INPUT_TOO_LARGE',
  'UNEXPECTED_BINARY',
  'INVALID_JSON',
  'NESTING_TOO_DEEP',
  'ROOT_NOT_OBJECT',
  'UNKNOWN_KEY',
  'MISSING_KEY',
  'UNSUPPORTED_SCHEMA_VERSION',
  'UNSUPPORTED_RULE_VERSION',
  'WRONG_TYPE',
  'EMPTY_STRING',
  'STRING_TOO_LONG',
  'TOO_MANY_ROWS',
  'INVALID_TIMESTAMP',
  'REVERSED_INTERVAL',
  'FUTURE_OBSERVATION',
  'DUPLICATE_ID',
  'WHITESPACE_COLLISION',
  'UNRESOLVED_REFERENCE',
  'INTEGER_OVERFLOW',
  'INTEGER_UNDERFLOW',
]);

const ROOT_KEYS = Object.freeze(['schemaVersion', 'ruleVersion', 'snapshotAt', 'assets', 'approvals', 'observations']);
const REQUIRED_ROOT_KEYS = Object.freeze(['schemaVersion', 'snapshotAt', 'assets', 'approvals', 'observations']);
const ASSET_KEYS = Object.freeze(['assetId', 'owner']);
const APPROVAL_KEYS = Object.freeze(['approvalId', 'assetId', 'pathId', 'validFrom', 'validThrough']);
const OBSERVATION_KEYS = Object.freeze(['observationId', 'assetId', 'pathId', 'observedAt']);

const ASCII_WHITESPACE_EDGES = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/** Trim ASCII whitespace only (never Unicode spaces), as the spec requires. */
export function trimAscii(text) {
  return text.replace(ASCII_WHITESPACE_EDGES, '');
}

export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}

/** Iterative depth measurement with early exit once the limit is exceeded. Root container is depth 1. */
export function measureDepth(root, limit = Infinity) {
  let max = 0;
  const stack = [[root, 1]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (depth > max) max = depth;
    if (depth > limit) return depth;
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
  return max;
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, path, message) {
  return { ok: false, errors: [{ code, path, message }] };
}

function makeCollector() {
  const errors = [];
  return {
    errors,
    err(code, path, message) {
      errors.push({ code, path, message });
    },
  };
}

function checkRecordShape(raw, path, allowedKeys, err) {
  if (!isPlainObject(raw)) {
    err('WRONG_TYPE', path, 'record must be a JSON object');
    return false;
  }
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.includes(key)) {
      err('UNKNOWN_KEY', `${path}.${key}`, `unknown key "${key}"`);
      ok = false;
    }
  }
  for (const key of allowedKeys) {
    if (!has(raw, key)) {
      err('MISSING_KEY', `${path}.${key}`, `missing required key "${key}"`);
      ok = false;
    }
  }
  return ok;
}

/** Returns the trimmed identifier or null after recording an error. */
function checkIdentifier(value, path, err) {
  if (typeof value !== 'string') {
    err('WRONG_TYPE', path, 'identifier must be a string');
    return null;
  }
  const trimmed = trimAscii(value);
  if (trimmed.length === 0) {
    err('EMPTY_STRING', path, 'identifier must not be empty');
    return null;
  }
  if (trimmed.length > LIMITS.maxIdentifierLength) {
    err('STRING_TOO_LONG', path, `identifier exceeds ${LIMITS.maxIdentifierLength} characters`);
    return null;
  }
  return trimmed;
}

function checkTimestamp(value, path, err) {
  if (typeof value !== 'string') {
    err('WRONG_TYPE', path, 'timestamp must be a string');
    return null;
  }
  const epoch = parseUtcTimestamp(value);
  if (epoch === null) {
    err('INVALID_TIMESTAMP', path, 'timestamp must be a real UTC calendar instant in YYYY-MM-DDTHH:MM:SSZ form');
    return null;
  }
  return epoch;
}

function registerId(registry, trimmed, raw, path, field, err) {
  const previous = registry.get(trimmed);
  if (previous) {
    if (previous.raw !== raw) {
      err(
        'WHITESPACE_COLLISION',
        path,
        `${field} "${trimmed}" collides with ${previous.path} once surrounding whitespace is trimmed`,
      );
    } else {
      err('DUPLICATE_ID', path, `${field} "${trimmed}" duplicates ${previous.path}`);
    }
    return false;
  }
  registry.set(trimmed, { raw, path });
  return true;
}

/**
 * Validate an already-parsed JSON value. Returns { ok: true, data } with trimmed identifiers,
 * or { ok: false, errors } listing every row/field-level problem found.
 */
export function validate(root) {
  const { errors, err } = makeCollector();

  if (!isPlainObject(root)) {
    err('ROOT_NOT_OBJECT', '$', 'input root must be a JSON object envelope');
    return { ok: false, errors };
  }

  for (const key of Object.keys(root)) {
    if (!ROOT_KEYS.includes(key)) err('UNKNOWN_KEY', `$.${key}`, `unknown key "${key}" on envelope`);
  }
  for (const key of REQUIRED_ROOT_KEYS) {
    if (!has(root, key)) err('MISSING_KEY', `$.${key}`, `missing required key "${key}"`);
  }
  if (has(root, 'schemaVersion') && root.schemaVersion !== SCHEMA_VERSION) {
    err('UNSUPPORTED_SCHEMA_VERSION', '$.schemaVersion', `schemaVersion must be "${SCHEMA_VERSION}"`);
  }
  if (has(root, 'ruleVersion') && root.ruleVersion !== RULE_VERSION) {
    err('UNSUPPORTED_RULE_VERSION', '$.ruleVersion', `ruleVersion must be "${RULE_VERSION}"`);
  }

  let snapshotEpoch = null;
  if (has(root, 'snapshotAt')) snapshotEpoch = checkTimestamp(root.snapshotAt, '$.snapshotAt', err);

  const rowLimits = {
    assets: LIMITS.maxAssets,
    approvals: LIMITS.maxApprovals,
    observations: LIMITS.maxObservations,
  };
  for (const [key, limit] of Object.entries(rowLimits)) {
    if (!has(root, key)) continue;
    if (!Array.isArray(root[key])) {
      err('WRONG_TYPE', `$.${key}`, `${key} must be an array`);
    } else if (root[key].length > limit) {
      err('TOO_MANY_ROWS', `$.${key}`, `${key} has ${root[key].length} rows; the limit is ${limit}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Assets
  const assetIds = new Map();
  const assets = [];
  root.assets.forEach((raw, i) => {
    const path = `$.assets[${i}]`;
    if (!checkRecordShape(raw, path, ASSET_KEYS, err)) return;
    const assetId = checkIdentifier(raw.assetId, `${path}.assetId`, err);
    let owner = raw.owner;
    if (owner !== null) {
      if (typeof owner !== 'string') {
        err('WRONG_TYPE', `${path}.owner`, 'owner must be a nonempty string or null');
        owner = null;
      } else if (trimAscii(owner).length === 0) {
        err('EMPTY_STRING', `${path}.owner`, 'owner must be a nonempty string or null; an empty string is not allowed');
      } else if (owner.length > LIMITS.maxIdentifierLength) {
        err('STRING_TOO_LONG', `${path}.owner`, `owner exceeds ${LIMITS.maxIdentifierLength} characters`);
      }
    }
    if (assetId === null) return;
    if (!registerId(assetIds, assetId, raw.assetId, `${path}.assetId`, 'assetId', err)) return;
    assets.push({ assetId, owner });
  });

  // Approvals
  const approvalIds = new Map();
  const approvals = [];
  root.approvals.forEach((raw, i) => {
    const path = `$.approvals[${i}]`;
    if (!checkRecordShape(raw, path, APPROVAL_KEYS, err)) return;
    const approvalId = checkIdentifier(raw.approvalId, `${path}.approvalId`, err);
    const assetId = checkIdentifier(raw.assetId, `${path}.assetId`, err);
    const pathId = checkIdentifier(raw.pathId, `${path}.pathId`, err);
    const fromEpoch = checkTimestamp(raw.validFrom, `${path}.validFrom`, err);
    const throughEpoch = checkTimestamp(raw.validThrough, `${path}.validThrough`, err);
    if (fromEpoch !== null && throughEpoch !== null && fromEpoch > throughEpoch) {
      err('REVERSED_INTERVAL', `${path}.validThrough`, 'validThrough must not be earlier than validFrom');
    }
    if (assetId !== null && !assetIds.has(assetId)) {
      err('UNRESOLVED_REFERENCE', `${path}.assetId`, `approval references unknown assetId "${assetId}"`);
    }
    if (approvalId === null) return;
    if (!registerId(approvalIds, approvalId, raw.approvalId, `${path}.approvalId`, 'approvalId', err)) return;
    if (assetId === null || pathId === null || fromEpoch === null || throughEpoch === null) return;
    approvals.push({ approvalId, assetId, pathId, validFrom: raw.validFrom, validThrough: raw.validThrough });
  });

  // Observations (unknown assets are valid input)
  const observationIds = new Map();
  const observations = [];
  root.observations.forEach((raw, i) => {
    const path = `$.observations[${i}]`;
    if (!checkRecordShape(raw, path, OBSERVATION_KEYS, err)) return;
    const observationId = checkIdentifier(raw.observationId, `${path}.observationId`, err);
    const assetId = checkIdentifier(raw.assetId, `${path}.assetId`, err);
    const pathId = checkIdentifier(raw.pathId, `${path}.pathId`, err);
    const observedEpoch = checkTimestamp(raw.observedAt, `${path}.observedAt`, err);
    if (observedEpoch !== null && snapshotEpoch !== null && observedEpoch > snapshotEpoch) {
      err('FUTURE_OBSERVATION', `${path}.observedAt`, 'observedAt must not be later than snapshotAt');
    }
    if (observationId === null) return;
    if (!registerId(observationIds, observationId, raw.observationId, `${path}.observationId`, 'observationId', err)) return;
    if (assetId === null || pathId === null || observedEpoch === null) return;
    observations.push({ observationId, assetId, pathId, observedAt: raw.observedAt });
  });

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      ruleVersion: RULE_VERSION,
      snapshotAt: root.snapshotAt,
      assets,
      approvals,
      observations,
    },
  };
}

/** Full pipeline from raw text. Never throws for bad input. */
export function parseInput(text) {
  if (typeof text !== 'string') return fail('INPUT_NOT_TEXT', '$', 'input must be a UTF-8 text string');
  const bytes = utf8ByteLength(text);
  if (bytes > LIMITS.maxInputBytes) {
    return fail('INPUT_TOO_LARGE', '$', `input is ${bytes} bytes; the limit is ${LIMITS.maxInputBytes} bytes`);
  }
  if (text.includes('\u0000') || text.includes('�')) {
    return fail('UNEXPECTED_BINARY', '$', 'input contains NUL or undecodable bytes; expected UTF-8 JSON text');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const detail = e && typeof e.message === 'string' ? e.message.slice(0, 200) : 'parse error';
    return fail('INVALID_JSON', '$', `input is not valid JSON: ${detail}`);
  }
  const depth = measureDepth(parsed, LIMITS.maxDepth);
  if (depth > LIMITS.maxDepth) {
    return fail('NESTING_TOO_DEEP', '$', `input nesting depth exceeds ${LIMITS.maxDepth}`);
  }
  return validate(parsed);
}
