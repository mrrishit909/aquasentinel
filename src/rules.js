// Versioned, fictional rule pack aqua-review-1. Pure, isomorphic ESM.
// Findings describe evidence gaps in imported records. They never describe exposure, severity or compromise.

export const RULE_VERSION = 'aqua-review-1';
export const STALE_THRESHOLD_SECONDS = 86400;

export const RULE_PACK = Object.freeze({
  ruleVersion: RULE_VERSION,
  schemaVersion: 'aqua-demo-1',
  provenance:
    'Fictional, illustrative rule pack. Its only source is the AquaSentinel vertical-slice specification file ' +
    '(atlas/docs/specs/AQUASENTINEL-VERTICAL-SLICE.md). It carries no legal, regulatory, clinical or operational ' +
    'authority, is not derived from any standard, and evaluates synthetic demo data only.',
  staleThresholdSeconds: STALE_THRESHOLD_SECONDS,
  rules: Object.freeze([
    Object.freeze({
      ruleId: 'AMBIGUOUS_APPROVAL',
      title: 'More than one approval covers the observation',
      description: 'Two or more approvals for the same (assetId, pathId) cover observedAt. Emitted once; suppresses OUTSIDE_APPROVAL_WINDOW.',
    }),
    Object.freeze({
      ruleId: 'NO_APPROVAL',
      title: 'No approval for the observed (assetId, pathId)',
      description: 'No approval record exists for the exact asset and path pair. Independent of asset knowledge.',
    }),
    Object.freeze({
      ruleId: 'OUTSIDE_APPROVAL_WINDOW',
      title: 'No approval window covers observedAt',
      description: 'Approvals exist for the pair but none covers observedAt (inclusive endpoints).',
    }),
    Object.freeze({
      ruleId: 'OWNER_MISSING',
      title: 'Observed asset has no recorded owner',
      description: 'The asset is in the register with owner null. Emitted once per observation.',
    }),
    Object.freeze({
      ruleId: 'STALE_OBSERVATION',
      title: 'Observation older than the freshness threshold',
      description: 'snapshotAt - observedAt exceeds 86,400 seconds. Exactly 86,400 seconds is not stale.',
    }),
    Object.freeze({
      ruleId: 'UNKNOWN_ASSET',
      title: 'Observed asset is absent from the register',
      description: 'The observation references an assetId that is not in assets[]. Valid input; recorded as an evidence gap.',
    }),
  ]),
});

/** Rule IDs in lexicographic order. */
export const RULE_IDS = Object.freeze(RULE_PACK.rules.map((r) => r.ruleId));

export function pairKey(assetId, pathId) {
  return `${assetId}\u0000${pathId}`;
}

/** Stable finding identifier. ruleId contains only [A-Z_], so the first ':' is an unambiguous separator. */
export function findingIdFor(observationId, ruleId) {
  return `${ruleId}:${observationId}`;
}

function approvalRecord(a) {
  return {
    approvalId: a.approvalId,
    assetId: a.assetId,
    pathId: a.pathId,
    validFrom: a.validFrom,
    validThrough: a.validThrough,
  };
}

/**
 * Evaluate one observation against the pack. Rules run independently.
 * context: { assetsById: Map, approvalsByPair: Map<pairKey, approval[] with epochs>, observedEpoch, ageSeconds }
 * Returns findings (unsorted) for this observation.
 */
export function evaluateObservation(obs, context) {
  const { assetsById, approvalsByPair, observedEpoch, ageSeconds } = context;
  const findings = [];
  const asset = assetsById.get(obs.assetId) ?? null;
  const observation = {
    observationId: obs.observationId,
    assetId: obs.assetId,
    pathId: obs.pathId,
    observedAt: obs.observedAt,
  };
  const emit = (ruleId, message, details, approvals) => {
    findings.push({
      findingId: findingIdFor(obs.observationId, ruleId),
      observationId: obs.observationId,
      ruleId,
      ruleVersion: RULE_VERSION,
      assetId: obs.assetId,
      pathId: obs.pathId,
      observedAt: obs.observedAt,
      message,
      details,
      evidence: {
        observation,
        asset: asset ? { assetId: asset.assetId, owner: asset.owner } : null,
        approvals: approvals.map(approvalRecord),
      },
    });
  };

  if (asset === null) {
    emit('UNKNOWN_ASSET', `Observation ${obs.observationId} references assetId "${obs.assetId}", which is not in the asset register.`, {}, []);
  }

  const candidates = approvalsByPair.get(pairKey(obs.assetId, obs.pathId)) ?? [];
  if (candidates.length === 0) {
    emit('NO_APPROVAL', `No approval record exists for (${obs.assetId}, ${obs.pathId}).`, {}, []);
  } else {
    const covering = candidates.filter(
      (a) => a.validFromEpoch <= observedEpoch && observedEpoch <= a.validThroughEpoch,
    );
    if (covering.length === 0) {
      emit(
        'OUTSIDE_APPROVAL_WINDOW',
        `Approvals exist for (${obs.assetId}, ${obs.pathId}) but none covers ${obs.observedAt}.`,
        { candidateApprovalIds: candidates.map((a) => a.approvalId) },
        candidates,
      );
    } else if (covering.length > 1) {
      emit(
        'AMBIGUOUS_APPROVAL',
        `${covering.length} approvals cover ${obs.observedAt} for (${obs.assetId}, ${obs.pathId}); the governing approval cannot be determined from the records.`,
        { coveringApprovalIds: covering.map((a) => a.approvalId) },
        covering,
      );
    }
  }

  if (asset !== null && asset.owner === null) {
    emit('OWNER_MISSING', `Asset ${asset.assetId} is registered without an owner.`, {}, []);
  }

  if (ageSeconds > STALE_THRESHOLD_SECONDS) {
    emit(
      'STALE_OBSERVATION',
      `Observation is ${ageSeconds} seconds older than the snapshot; the freshness threshold is ${STALE_THRESHOLD_SECONDS} seconds.`,
      { ageSeconds, thresholdSeconds: STALE_THRESHOLD_SECONDS },
      [],
    );
  }

  return findings;
}
