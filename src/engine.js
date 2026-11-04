// Deterministic reconciliation engine. Pure, isomorphic ESM (no node: imports, no clock, no network).

import { parseInput, LIMITS, SCHEMA_VERSION, RULE_VERSION } from './schema.js';
import { parseUtcTimestamp } from './dates.js';
import { RULE_PACK, RULE_IDS, pairKey, evaluateObservation } from './rules.js';
import { addOrThrow, differenceOrThrow, OverflowError } from './integers.js';
import { deepFreeze, SYNTHETIC_NOTICE, PROVENANCE, FIXTURE_PROVENANCE, USER_PROVENANCE } from './report.js';

/** Resolve the caller-chosen provenance key. Missing means unverified; an unknown key is a programming error. */
function resolveProvenance(provenance = USER_PROVENANCE) {
  if (typeof provenance !== 'string' || !Object.hasOwn(PROVENANCE, provenance)) {
    throw new TypeError(`provenance must be one of ${Object.keys(PROVENANCE).join(', ')}`);
  }
  return provenance;
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareFindings(a, b) {
  return compareStrings(a.observationId, b.observationId) || compareStrings(a.ruleId, b.ruleId);
}

function sortedBy(records, key) {
  return [...records].sort((a, b) => compareStrings(a[key], b[key]));
}

/**
 * Build a frozen report from validated data (the output of parseInput / validate).
 * Returns { ok: true, report } or { ok: false, errors } when checked arithmetic fails.
 */
export function buildReport(data, { provenance } = {}) {
  provenance = resolveProvenance(provenance);
  const snapshotEpoch = parseUtcTimestamp(data.snapshotAt);
  if (snapshotEpoch === null) throw new TypeError('buildReport requires validated data (invalid snapshotAt)');
  try {
    const assetsById = new Map(data.assets.map((a) => [a.assetId, a]));
    const approvalsByPair = new Map();
    for (const ap of sortedBy(data.approvals, 'approvalId')) {
      const key = pairKey(ap.assetId, ap.pathId);
      const list = approvalsByPair.get(key) ?? [];
      list.push({
        ...ap,
        validFromEpoch: parseUtcTimestamp(ap.validFrom),
        validThroughEpoch: parseUtcTimestamp(ap.validThrough),
      });
      approvalsByPair.set(key, list);
    }

    const findings = [];
    const observations = [];
    const ageSecondsByObservation = {};
    let totalAgeSeconds = 0;
    let flagged = 0;
    let unknownAssetObservations = 0;

    for (const obs of sortedBy(data.observations, 'observationId')) {
      const observedEpoch = parseUtcTimestamp(obs.observedAt);
      if (observedEpoch === null) throw new TypeError('buildReport requires validated data (invalid observedAt)');
      const ageSeconds = differenceOrThrow(snapshotEpoch, observedEpoch);
      const own = evaluateObservation(obs, { assetsById, approvalsByPair, observedEpoch, ageSeconds });
      const ruleIds = own.map((f) => f.ruleId).sort(compareStrings);
      findings.push(...own);
      ageSecondsByObservation[obs.observationId] = ageSeconds;
      totalAgeSeconds = addOrThrow(totalAgeSeconds, ageSeconds);
      if (own.length > 0) flagged = addOrThrow(flagged, 1);
      if (!assetsById.has(obs.assetId)) unknownAssetObservations = addOrThrow(unknownAssetObservations, 1);
      observations.push({
        observationId: obs.observationId,
        assetId: obs.assetId,
        pathId: obs.pathId,
        observedAt: obs.observedAt,
        ageSeconds,
        assetKnown: assetsById.has(obs.assetId),
        flagged: own.length > 0,
        ruleIds,
      });
    }

    findings.sort(compareFindings);

    const countsByRule = {};
    for (const ruleId of RULE_IDS) countsByRule[ruleId] = 0;
    for (const f of findings) countsByRule[f.ruleId] = addOrThrow(countsByRule[f.ruleId], 1);

    const observationCount = data.observations.length;
    const summary = {
      assets: data.assets.length,
      approvals: data.approvals.length,
      observations: observationCount,
      flaggedObservations: flagged,
      structurallyConsistentObservations: differenceOrThrow(observationCount, flagged),
      unknownAssetObservations,
      findings: findings.length,
      countsByRule,
      totalAgeSeconds,
      ageSecondsByObservation,
    };

    const report = {
      reportVersion: 2,
      product: 'AquaSentinel vertical slice',
      provenance,
      dataLabel: PROVENANCE[provenance].dataLabel,
      dataNotice: PROVENANCE[provenance].notice,
      syntheticNotice: provenance === FIXTURE_PROVENANCE ? SYNTHETIC_NOTICE : null,
      schemaVersion: SCHEMA_VERSION,
      ruleVersion: RULE_VERSION,
      rulePack: {
        ruleVersion: RULE_PACK.ruleVersion,
        provenance: RULE_PACK.provenance,
        staleThresholdSeconds: RULE_PACK.staleThresholdSeconds,
        ruleIds: [...RULE_IDS],
      },
      limits: { ...LIMITS },
      snapshotAt: data.snapshotAt,
      input: {
        schemaVersion: data.schemaVersion,
        ruleVersion: data.ruleVersion,
        snapshotAt: data.snapshotAt,
        assets: sortedBy(data.assets, 'assetId'),
        approvals: sortedBy(data.approvals, 'approvalId'),
        observations: sortedBy(data.observations, 'observationId'),
      },
      observations,
      findings,
      summary,
    };
    return { ok: true, report: deepFreeze(report) };
  } catch (e) {
    if (e instanceof OverflowError) {
      return { ok: false, errors: [{ code: e.code, path: '$', message: e.message }] };
    }
    throw e;
  }
}

/**
 * Raw text in, frozen report or error list out. Never throws for bad input.
 * `provenance` is chosen by the calling code path, never read from the text; it defaults to unverified.
 */
export function analyze(text, { provenance } = {}) {
  provenance = resolveProvenance(provenance);
  const parsed = parseInput(text);
  if (!parsed.ok) return parsed;
  return buildReport(parsed.data, { provenance });
}

/** Compare two reports by finding key. Returns sorted arrays of findingIds. */
export function compareSnapshots(reportA, reportB) {
  const a = new Set(reportA.findings.map((f) => f.findingId));
  const b = new Set(reportB.findings.map((f) => f.findingId));
  const added = [...b].filter((id) => !a.has(id)).sort(compareStrings);
  const removed = [...a].filter((id) => !b.has(id)).sort(compareStrings);
  const unchanged = [...a].filter((id) => b.has(id)).sort(compareStrings);
  return { added, removed, unchanged };
}
