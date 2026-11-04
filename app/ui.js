// Pure, testable UI helpers. No DOM access here. Isomorphic ESM.
import { csvCell } from '../src/report.js';

export { csvCell };

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe insertion where textContent is not available (attribute values, option labels). */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Filter findings by exact rule ID, case-insensitive entity text (observationId, assetId, pathId, findingId),
 * and the spec-named "unknown assets" and "missing approvals" filters.
 */
export function filterFindings(findings, { ruleId = '', query = '', unknownAssetsOnly = false, missingApprovalOnly = false } = {}) {
  const q = query.trim().toLowerCase();
  return findings.filter((f) => {
    if (ruleId && f.ruleId !== ruleId) return false;
    if (unknownAssetsOnly && f.evidence.asset !== null) return false;
    if (missingApprovalOnly && f.ruleId !== 'NO_APPROVAL') return false;
    if (q) {
      const hay = `${f.observationId}\n${f.assetId}\n${f.pathId}\n${f.findingId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** 90000 -> "25 h 00 m" ; 3600 -> "1 h 00 m" ; 59 -> "0 h 00 m 59 s". */
export function formatAge(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return 'n/a';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const base = `${h} h ${String(m).padStart(2, '0')} m`;
  return s === 0 ? base : `${base} ${String(s).padStart(2, '0')} s`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Group validation errors for display: [{code, path, message}] -> stable sorted copy by path then code. */
export function sortErrors(errors) {
  return [...errors].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * Message for an empty findings table, or null when rows are shown. Three distinct states:
 * no records at all, zero evidence gaps across real records, and filters hiding every finding.
 */
export function emptyFindingsMessage(summary, shownCount) {
  if (shownCount > 0) return null;
  if (summary.observations === 0) return 'No records to reconcile: this dataset contains zero observations.';
  if (summary.findings === 0) return 'Zero evidence gaps: every observation is structurally consistent with the imported registers. This is not a safety or security claim.';
  return 'No findings match the current filters.';
}

/** Build a download file name from an injected timestamp (no clock access here). */
export function exportFileName(generatedAt, extension) {
  const stamp = String(generatedAt).replace(/[^0-9TZ]/g, '');
  return `aquasentinel-synthetic-${stamp}.${extension}`;
}
