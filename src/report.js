// Report helpers: deep freeze, review layer (notes/decisions), export, CSV, round trip. Pure, isomorphic ESM.
// The engine never reads the system clock: generatedAt and sourceHash are injected by the caller.

import { LIMITS, SCHEMA_VERSION, RULE_VERSION, utf8ByteLength } from './schema.js';
import { parseUtcTimestamp } from './dates.js';
import { RULE_PACK } from './rules.js';

export const SYNTHETIC_NOTICE =
  'SYNTHETIC DEMO DATA. Fictional utility, fictional assets, approvals and observations. ' +
  'Not real infrastructure, not a security assessment, no regulatory or compliance meaning.';

export const UNVERIFIED_NOTICE =
  'UNVERIFIED USER-SUPPLIED DATA. These records came from a local file or pasted text in this browser tab; ' +
  'their origin, accuracy and authorization have not been verified, and this label does not detect or prevent real data. ' +
  'The rule pack is fictional. Not a security assessment, no regulatory or compliance meaning.';

/**
 * Data provenance is decided by the calling code path (bundled fixture vs. local file/paste), never by the
 * input JSON. Missing provenance means unverified; analyze() throws on any other unknown key.
 */
export const PROVENANCE = deepFreeze({
  'bundled-synthetic-fixture': { dataLabel: 'SYNTHETIC DEMO DATA', notice: SYNTHETIC_NOTICE },
  'unverified-user-supplied': { dataLabel: 'UNVERIFIED USER-SUPPLIED DATA', notice: UNVERIFIED_NOTICE },
});
export const FIXTURE_PROVENANCE = 'bundled-synthetic-fixture';
export const USER_PROVENANCE = 'unverified-user-supplied';

/** Provenance key of a report; reports without one (reportVersion 1) are treated as unverified. */
export function reportProvenance(report) {
  return report && report.provenance === FIXTURE_PROVENANCE ? FIXTURE_PROVENANCE : USER_PROVENANCE;
}

export const DISPOSITIONS = Object.freeze(['open', 'reviewed', 'assigned', 'deferred']);

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
  return value;
}

// ---------- Review layer (separate from the frozen report) ----------

export function createReviewLayer() {
  return deepFreeze({ notes: [], decisions: [] });
}

function layerError(code, path, message) {
  return { ok: false, errors: [{ code, path, message }] };
}

function checkFindingId(report, findingId, path) {
  if (typeof findingId !== 'string' || findingId.length === 0) {
    return layerError('WRONG_TYPE', path, 'findingId must be a nonempty string');
  }
  if (report && !report.findings.some((f) => f.findingId === findingId)) {
    return layerError('UNRESOLVED_REFERENCE', path, `no finding with id "${findingId}" in this report`);
  }
  return null;
}

function checkBoundedText(value, path, max, label, required) {
  if (value === undefined || value === null) {
    return required ? layerError('MISSING_KEY', path, `${label} is required`) : null;
  }
  if (typeof value !== 'string') return layerError('WRONG_TYPE', path, `${label} must be a string`);
  if (required && value.trim().length === 0) return layerError('EMPTY_STRING', path, `${label} must not be empty`);
  if (value.length > max) return layerError('STRING_TOO_LONG', path, `${label} exceeds ${max} characters`);
  return null;
}

/** Returns { ok: true, layer } with a new frozen layer, or { ok: false, errors }. Never mutates inputs. */
export function addNote(layer, report, { findingId, text, author, recordedAt }) {
  const e1 = checkFindingId(report, findingId, 'note.findingId');
  if (e1) return e1;
  const e2 = checkBoundedText(text, 'note.text', LIMITS.maxNoteLength, 'note text', true);
  if (e2) return e2;
  const e3 = checkBoundedText(author, 'note.author', LIMITS.maxIdentifierLength, 'author', false);
  if (e3) return e3;
  if (parseUtcTimestamp(recordedAt) === null) {
    return layerError('INVALID_TIMESTAMP', 'note.recordedAt', 'recordedAt must be a strict UTC timestamp');
  }
  const note = { findingId, text, author: author ?? null, recordedAt };
  return { ok: true, layer: deepFreeze({ notes: [...layer.notes, note], decisions: layer.decisions }) };
}

/** Records a disposition for a finding; the latest decision per finding wins, history is retained. */
export function recordDecision(layer, report, { findingId, disposition, reviewer, recordedAt }) {
  const e1 = checkFindingId(report, findingId, 'decision.findingId');
  if (e1) return e1;
  if (!DISPOSITIONS.includes(disposition)) {
    return layerError('WRONG_TYPE', 'decision.disposition', `disposition must be one of ${DISPOSITIONS.join(', ')}`);
  }
  const e3 = checkBoundedText(reviewer, 'decision.reviewer', LIMITS.maxIdentifierLength, 'reviewer', false);
  if (e3) return e3;
  if (parseUtcTimestamp(recordedAt) === null) {
    return layerError('INVALID_TIMESTAMP', 'decision.recordedAt', 'recordedAt must be a strict UTC timestamp');
  }
  const decision = { findingId, disposition, reviewer: reviewer ?? null, recordedAt };
  return { ok: true, layer: deepFreeze({ notes: layer.notes, decisions: [...layer.decisions, decision] }) };
}

export function notesFor(layer, findingId) {
  return layer.notes.filter((n) => n.findingId === findingId);
}

export function currentDecision(layer, findingId) {
  let latest = null;
  for (const d of layer.decisions) if (d.findingId === findingId) latest = d;
  return latest;
}

// ---------- Export ----------

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Build a JSON-serializable export object. generatedAt and sourceHash are injected by the caller.
 * Throws TypeError on malformed options; never reads the system clock.
 */
export function buildExport(report, { generatedAt, sourceHash, notes = [], decisions = [] } = {}) {
  if (!report || !Array.isArray(report.findings) || !report.summary) throw new TypeError('report is required');
  if (parseUtcTimestamp(generatedAt) === null) throw new TypeError('generatedAt must be a strict UTC timestamp');
  if (typeof sourceHash !== 'string' || !SHA256_HEX.test(sourceHash)) {
    throw new TypeError('sourceHash must be a lowercase SHA-256 hex digest of the raw input text');
  }
  if (!Array.isArray(notes) || !Array.isArray(decisions)) throw new TypeError('notes and decisions must be arrays');
  const provenance = reportProvenance(report);
  const { dataLabel, notice } = PROVENANCE[provenance];
  return {
    exportVersion: 2,
    product: 'AquaSentinel vertical slice',
    provenance,
    dataLabel,
    dataNotice: notice,
    // Kept for exportVersion 1 readers; null whenever the data is not a bundled synthetic fixture.
    syntheticNotice: provenance === FIXTURE_PROVENANCE ? SYNTHETIC_NOTICE : null,
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    rulePack: {
      ruleVersion: RULE_PACK.ruleVersion,
      provenance: RULE_PACK.provenance,
      staleThresholdSeconds: RULE_PACK.staleThresholdSeconds,
    },
    generatedAt,
    sourceHash,
    snapshotAt: report.snapshotAt,
    input: report.input,
    summary: report.summary,
    observations: report.observations,
    findings: report.findings,
    notes,
    decisions,
  };
}

/** Serialize with the 10 MiB cap. Returns { ok: true, text, bytes } or { ok: false, errors }. */
export function serializeExport(exportObject) {
  let text;
  try {
    text = JSON.stringify(exportObject, null, 2);
  } catch (e) {
    return layerError('EXPORT_NOT_SERIALIZABLE', '$', `export cannot be serialized: ${String(e && e.message).slice(0, 200)}`);
  }
  if (typeof text !== 'string') return layerError('EXPORT_NOT_SERIALIZABLE', '$', 'export produced no JSON text');
  const bytes = utf8ByteLength(text);
  if (bytes > LIMITS.maxExportBytes) {
    return layerError('EXPORT_TOO_LARGE', '$', `export is ${bytes} bytes; the limit is ${LIMITS.maxExportBytes} bytes`);
  }
  return { ok: true, text, bytes };
}

/** Parse an export back. Returns { ok, data } or { ok: false, errors }. */
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return layerError('INVALID_JSON', '$', 'export text is not valid JSON');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.findings) || !data.summary) {
    return layerError('WRONG_TYPE', '$', 'export is missing findings or summary');
  }
  return { ok: true, data };
}

// ---------- CSV (RFC 4180 quoting, formula neutralization) ----------

const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Neutralize spreadsheet formula leaders with a single quote, then quote per RFC 4180 when needed. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (text.length > 0 && FORMULA_LEADERS.has(text[0])) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const CSV_COLUMNS = Object.freeze([
  'dataLabel',
  'findingId',
  'observationId',
  'ruleId',
  'ruleVersion',
  'assetId',
  'pathId',
  'observedAt',
  'snapshotAt',
  'ageSeconds',
  'message',
  'disposition',
  'reviewer',
  'notes',
]);

export function buildCsvRows(report, layer = createReviewLayer()) {
  const ages = report.summary.ageSecondsByObservation;
  const { dataLabel } = PROVENANCE[reportProvenance(report)];
  return report.findings.map((f) => {
    const decision = currentDecision(layer, f.findingId);
    const notes = notesFor(layer, f.findingId).map((n) => n.text).join(' | ');
    return [
      dataLabel,
      f.findingId,
      f.observationId,
      f.ruleId,
      f.ruleVersion,
      f.assetId,
      f.pathId,
      f.observedAt,
      report.snapshotAt,
      ages[f.observationId],
      f.message,
      decision ? decision.disposition : '',
      decision && decision.reviewer ? decision.reviewer : '',
      notes,
    ];
  });
}

/** Returns { ok: true, text, bytes } or { ok: false, errors } (10 MiB cap). */
export function exportCsv(report, layer = createReviewLayer()) {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const row of buildCsvRows(report, layer)) lines.push(row.map(csvCell).join(','));
  const text = lines.join('\r\n') + '\r\n';
  const bytes = utf8ByteLength(text);
  if (bytes > LIMITS.maxExportBytes) {
    return layerError('EXPORT_TOO_LARGE', '$', `CSV export is ${bytes} bytes; the limit is ${LIMITS.maxExportBytes} bytes`);
  }
  return { ok: true, text, bytes };
}
