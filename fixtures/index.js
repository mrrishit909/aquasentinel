// Synthetic fixtures: the single source of truth for tests and the workbench UI.
// SYNTHETIC DEMO DATA ONLY. Fictional utility, fictional identifiers. No real infrastructure.
// Golden values are copied from atlas/docs/specs/AQUASENTINEL-VERTICAL-SLICE.md.

import { deepFreeze } from '../src/report.js';

export const SYNTHETIC_LABEL = 'SYNTHETIC DEMO DATA';

export const GOLDEN = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [
    { assetId: 'A1', owner: 'Ops' },
    { assetId: 'A2', owner: null },
  ],
  approvals: [
    { approvalId: 'P1', assetId: 'A1', pathId: 'V1', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-04T00:00:00Z' },
    { approvalId: 'P2', assetId: 'A2', pathId: 'V2', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-02T00:00:00Z' },
  ],
  observations: [
    { observationId: 'O1', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T11:00:00Z' },
    { observationId: 'O2', assetId: 'A1', pathId: 'V9', observedAt: '2026-11-03T11:00:00Z' },
    { observationId: 'O3', assetId: 'A9', pathId: 'V9', observedAt: '2026-11-03T11:00:00Z' },
    { observationId: 'O4', assetId: 'A2', pathId: 'V2', observedAt: '2026-11-03T10:00:00Z' },
    { observationId: 'O5', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-02T11:00:00Z' },
  ],
});

/** Hand-computed oracle from the spec. */
export const GOLDEN_ORACLE = deepFreeze({
  observations: 5,
  flaggedObservations: 4,
  structurallyConsistentObservations: 1,
  findings: 6,
  countsByRule: {
    AMBIGUOUS_APPROVAL: 0,
    NO_APPROVAL: 2,
    OUTSIDE_APPROVAL_WINDOW: 1,
    OWNER_MISSING: 1,
    STALE_OBSERVATION: 1,
    UNKNOWN_ASSET: 1,
  },
  rulesByObservation: {
    O1: [],
    O2: ['NO_APPROVAL'],
    O3: ['NO_APPROVAL', 'UNKNOWN_ASSET'],
    O4: ['OUTSIDE_APPROVAL_WINDOW', 'OWNER_MISSING'],
    O5: ['STALE_OBSERVATION'],
  },
  ageSecondsByObservation: { O1: 3600, O2: 3600, O3: 3600, O4: 7200, O5: 90000 },
});

/** Clean variant: every observation is covered, owned and fresh. Zero findings expected. */
export const CLEAN = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [
    { assetId: 'A1', owner: 'Ops' },
    { assetId: 'A2', owner: 'Maintenance' },
  ],
  approvals: [
    { approvalId: 'P1', assetId: 'A1', pathId: 'V1', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-04T00:00:00Z' },
    { approvalId: 'P2', assetId: 'A2', pathId: 'V2', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-04T00:00:00Z' },
  ],
  observations: [
    { observationId: 'O1', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T11:00:00Z' },
    { observationId: 'O2', assetId: 'A2', pathId: 'V2', observedAt: '2026-11-02T12:00:00Z' },
  ],
});

export const EMPTY = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [],
  approvals: [],
  observations: [],
});

/** Adversarial case 4: overlapping approval for O1 (A1/V1). */
export const AMBIGUOUS = deepFreeze({
  ...GOLDEN,
  approvals: [
    ...GOLDEN.approvals,
    { approvalId: 'P3', assetId: 'A1', pathId: 'V1', validFrom: '2026-11-03T00:00:00Z', validThrough: '2026-11-03T11:30:00Z' },
  ],
});

/** Adversarial case 3: endpoint and threshold boundaries. */
export const BOUNDARY = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [{ assetId: 'A1', owner: 'Ops' }],
  approvals: [
    { approvalId: 'P1', assetId: 'A1', pathId: 'V1', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-02T00:00:00Z' },
  ],
  observations: [
    { observationId: 'B-START', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-01T00:00:00Z' },
    { observationId: 'B-END', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-02T00:00:00Z' },
    { observationId: 'B-BEFORE', assetId: 'A1', pathId: 'V1', observedAt: '2026-10-31T23:59:59Z' },
    { observationId: 'B-AFTER', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-02T00:00:01Z' },
    { observationId: 'S-EXACT', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-02T12:00:00Z' },
    { observationId: 'S-OVER', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-02T11:59:59Z' },
  ],
});

/** Adversarial case 1: duplicate IDs and whitespace-normalization collision. */
export const DUPLICATE_ASSET = deepFreeze({
  ...GOLDEN,
  assets: [...GOLDEN.assets, { assetId: 'A1', owner: 'Second' }],
});
export const WHITESPACE_COLLISION = deepFreeze({
  ...GOLDEN,
  observations: [...GOLDEN.observations, { observationId: ' O1 ', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T11:00:00Z' }],
});
export const DUPLICATE_APPROVAL = deepFreeze({
  ...GOLDEN,
  approvals: [...GOLDEN.approvals, { approvalId: 'P1', assetId: 'A2', pathId: 'V2', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-02T00:00:00Z' }],
});

/** Adversarial case 2: timestamp defects, one per record. */
export const BAD_TIMESTAMPS = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [{ assetId: 'A1', owner: 'Ops' }],
  approvals: [
    { approvalId: 'P-REVERSED', assetId: 'A1', pathId: 'V1', validFrom: '2026-11-04T00:00:00Z', validThrough: '2026-11-01T00:00:00Z' },
  ],
  observations: [
    { observationId: 'T-CALENDAR', assetId: 'A1', pathId: 'V1', observedAt: '2026-02-30T00:00:00Z' },
    { observationId: 'T-NO-ZONE', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T11:00:00' },
    { observationId: 'T-OFFSET', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T11:00:00+02:00' },
    { observationId: 'T-FUTURE', assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T12:00:01Z' },
  ],
});

/** Adversarial case 6: HTML, script and formula payloads in identifiers. Valid input; must render as text. */
export const PAYLOADS = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [
    { assetId: '<script>alert(1)</script>', owner: '<img src=x onerror=alert(1)>' },
    { assetId: '=HYPERLINK("http://192.0.2.1","x")', owner: null },
  ],
  approvals: [],
  observations: [
    { observationId: '=1+1', assetId: '<script>alert(1)</script>', pathId: '+SUM(A1:A9)', observedAt: '2026-11-03T11:00:00Z' },
    { observationId: '@cmd', assetId: '=HYPERLINK("http://192.0.2.1","x")', pathId: '-2+3', observedAt: '2026-11-03T11:00:00Z' },
    { observationId: 'O-TAB', assetId: 'A-unknown', pathId: '\tV1', observedAt: '2026-11-03T11:00:00Z' },
  ],
});

/** Adversarial case 7: URL-like identifiers are plain text; nothing may be fetched. RFC 5737 documentation addresses only. */
export const URL_LIKE = deepFreeze({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [{ assetId: 'https://198.51.100.7/plc', owner: 'Ops' }],
  approvals: [],
  observations: [
    { observationId: 'http://203.0.113.9/export.json', assetId: 'https://198.51.100.7/plc', pathId: 'vendor://example.invalid/path', observedAt: '2026-11-03T11:00:00Z' },
  ],
});

/** Named fixtures offered by the workbench. */
export const FIXTURES = deepFreeze({
  golden: { name: 'golden', label: 'Golden (spec oracle, 6 evidence gaps)', data: GOLDEN },
  clean: { name: 'clean', label: 'Clean (zero evidence gaps)', data: CLEAN },
  empty: { name: 'empty', label: 'Empty (no records)', data: EMPTY },
  ambiguous: { name: 'ambiguous', label: 'Ambiguous approval (overlapping P3)', data: AMBIGUOUS },
  payloads: { name: 'payloads', label: 'Hostile text payloads (renders as text)', data: PAYLOADS },
});

/** Canonical text form of a fixture: the bytes the engine and sourceHash operate on. */
export function fixtureText(fixture) {
  return JSON.stringify(fixture, null, 2) + '\n';
}
