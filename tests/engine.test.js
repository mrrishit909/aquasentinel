import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, compareSnapshots, RULE_IDS, RULE_PACK, buildReport, parseInput } from '../src/index.js';
import { GOLDEN, GOLDEN_ORACLE, CLEAN, EMPTY, AMBIGUOUS, BOUNDARY, URL_LIKE, fixtureText } from '../fixtures/index.js';

function run(fixture) {
  const r = analyze(fixtureText(fixture), { provenance: 'bundled-synthetic-fixture' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.report;
}

function rulesByObservation(report) {
  const out = {};
  for (const o of report.observations) out[o.observationId] = o.ruleIds;
  return out;
}

test('golden oracle: counts, per-observation rules, ages, order and IDs match the spec exactly', () => {
  const report = run(GOLDEN);
  const s = report.summary;
  assert.equal(s.observations, GOLDEN_ORACLE.observations);
  assert.equal(s.flaggedObservations, GOLDEN_ORACLE.flaggedObservations);
  assert.equal(s.structurallyConsistentObservations, GOLDEN_ORACLE.structurallyConsistentObservations);
  assert.equal(s.findings, GOLDEN_ORACLE.findings);
  assert.deepEqual(s.countsByRule, GOLDEN_ORACLE.countsByRule);
  assert.deepEqual(Object.keys(s.countsByRule), [...RULE_IDS]);
  assert.deepEqual(rulesByObservation(report), GOLDEN_ORACLE.rulesByObservation);
  assert.deepEqual(s.ageSecondsByObservation, GOLDEN_ORACLE.ageSecondsByObservation);
  assert.equal(s.ageSecondsByObservation.O5, 90000);
  assert.equal(s.totalAgeSeconds, 3600 * 3 + 7200 + 90000);
  assert.deepEqual(
    report.findings.map((f) => [f.observationId, f.ruleId]),
    [
      ['O2', 'NO_APPROVAL'],
      ['O3', 'NO_APPROVAL'],
      ['O3', 'UNKNOWN_ASSET'],
      ['O4', 'OUTSIDE_APPROVAL_WINDOW'],
      ['O4', 'OWNER_MISSING'],
      ['O5', 'STALE_OBSERVATION'],
    ],
  );
  assert.deepEqual(report.findings.map((f) => f.findingId), [
    'NO_APPROVAL:O2', 'NO_APPROVAL:O3', 'UNKNOWN_ASSET:O3', 'OUTSIDE_APPROVAL_WINDOW:O4', 'OWNER_MISSING:O4', 'STALE_OBSERVATION:O5',
  ]);
  for (const f of report.findings) {
    assert.equal(f.ruleVersion, 'aqua-review-1');
    assert.equal(f.evidence.observation.observationId, f.observationId);
  }
  assert.equal(report.ruleVersion, 'aqua-review-1');
  assert.equal(report.schemaVersion, 'aqua-demo-1');
  assert.match(report.rulePack.provenance, /Fictional/);
  assert.match(report.rulePack.provenance, /AQUASENTINEL-VERTICAL-SLICE\.md/);
  assert.equal(report.dataLabel, 'SYNTHETIC DEMO DATA');
  assert.ok(!('severity' in report.findings[0]));
  assert.ok(!('probability' in report.summary));
});

test('golden: cited evidence records are the original input records', () => {
  const report = run(GOLDEN);
  const o4 = report.findings.find((f) => f.findingId === 'OUTSIDE_APPROVAL_WINDOW:O4');
  assert.deepEqual(o4.evidence.asset, { assetId: 'A2', owner: null });
  assert.deepEqual(o4.evidence.approvals.map((a) => a.approvalId), ['P2']);
  assert.deepEqual(o4.details, { candidateApprovalIds: ['P2'] });
  assert.deepEqual(report.input.observations, [...GOLDEN.observations]);
  assert.deepEqual(report.input.assets, [...GOLDEN.assets]);
  assert.deepEqual(report.input.approvals, [...GOLDEN.approvals]);
});

test('clean variant yields zero findings and all observations consistent', () => {
  const report = run(CLEAN);
  assert.equal(report.findings.length, 0);
  assert.equal(report.summary.flaggedObservations, 0);
  assert.equal(report.summary.structurallyConsistentObservations, 2);
  assert.deepEqual(report.summary.countsByRule, Object.fromEntries(RULE_IDS.map((id) => [id, 0])));
  assert.equal(report.summary.ageSecondsByObservation.O2, 86400);
});

test('empty fixture is valid and yields zero totals', () => {
  const report = run(EMPTY);
  assert.equal(report.summary.observations, 0);
  assert.equal(report.summary.findings, 0);
  assert.equal(report.summary.totalAgeSeconds, 0);
});

test('adversarial 3: inclusive approval endpoints and exact stale threshold', () => {
  const rules = rulesByObservation(run(BOUNDARY));
  assert.deepEqual(rules['B-START'], ['STALE_OBSERVATION']); // covered at start; it is also > 86400 s old
  assert.deepEqual(rules['B-END'], ['STALE_OBSERVATION']); // covered at end; age 129600 s
  assert.deepEqual(rules['B-BEFORE'], ['OUTSIDE_APPROVAL_WINDOW', 'STALE_OBSERVATION']);
  assert.deepEqual(rules['B-AFTER'], ['OUTSIDE_APPROVAL_WINDOW', 'STALE_OBSERVATION']);
  assert.deepEqual(rules['S-EXACT'], ['OUTSIDE_APPROVAL_WINDOW']); // age exactly 86400: not stale
  assert.deepEqual(rules['S-OVER'], ['OUTSIDE_APPROVAL_WINDOW', 'STALE_OBSERVATION']); // age 86401
  const report = run(BOUNDARY);
  assert.equal(report.summary.ageSecondsByObservation['S-EXACT'], 86400);
  assert.equal(report.summary.ageSecondsByObservation['S-OVER'], 86401);
});

test('adversarial 4: overlapping approval for O1 gives exactly one AMBIGUOUS_APPROVAL, no OUTSIDE_APPROVAL_WINDOW, others unchanged', () => {
  const golden = run(GOLDEN);
  const amb = run(AMBIGUOUS);
  const o1 = amb.findings.filter((f) => f.observationId === 'O1');
  assert.deepEqual(o1.map((f) => f.ruleId), ['AMBIGUOUS_APPROVAL']);
  assert.deepEqual(o1[0].details.coveringApprovalIds, ['P1', 'P3']);
  assert.equal(amb.summary.countsByRule.AMBIGUOUS_APPROVAL, 1);
  assert.equal(amb.summary.countsByRule.OUTSIDE_APPROVAL_WINDOW, 1);
  assert.deepEqual(
    amb.findings.filter((f) => f.observationId !== 'O1').map((f) => f.findingId),
    golden.findings.map((f) => f.findingId),
  );
  assert.equal(amb.summary.flaggedObservations, 5);
  const diff = compareSnapshots(golden, amb);
  assert.deepEqual(diff, { added: ['AMBIGUOUS_APPROVAL:O1'], removed: [], unchanged: golden.findings.map((f) => f.findingId).sort() });
});

test('adversarial 5: unknown A9 keeps two independent findings; absence of observation implies nothing', () => {
  const report = run(GOLDEN);
  const o3 = report.findings.filter((f) => f.observationId === 'O3');
  assert.deepEqual(o3.map((f) => f.ruleId), ['NO_APPROVAL', 'UNKNOWN_ASSET']);
  assert.equal(o3[0].evidence.asset, null);
  assert.equal(o3[1].evidence.asset, null);
  // A2/V2 has an approval but O-type observation only for O4; the engine emits nothing about unobserved pairs.
  assert.ok(report.findings.every((f) => report.input.observations.some((o) => o.observationId === f.observationId)));
  assert.ok(!JSON.stringify(report).match(/safe|secure|compromise|exposure|threat/i), 'report text must not make exposure or safety claims');
});

test('determinism: shuffling input arrays produces a byte-identical report', () => {
  const base = run(GOLDEN);
  const shuffled = {
    ...GOLDEN,
    assets: [...GOLDEN.assets].reverse(),
    approvals: [...GOLDEN.approvals].reverse(),
    observations: [GOLDEN.observations[3], GOLDEN.observations[0], GOLDEN.observations[4], GOLDEN.observations[2], GOLDEN.observations[1]],
  };
  const other = run(shuffled);
  assert.equal(JSON.stringify(other), JSON.stringify(base));
  assert.deepEqual(other, base);
  const again = run(GOLDEN);
  assert.equal(JSON.stringify(again), JSON.stringify(base));
});

test('immutability: the report is deep-frozen and mutation throws in strict mode', () => {
  const report = run(GOLDEN);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.findings));
  assert.ok(Object.isFrozen(report.findings[0].evidence.observation));
  assert.ok(Object.isFrozen(report.summary.countsByRule));
  assert.throws(() => { report.summary.findings = 0; }, TypeError);
  assert.throws(() => { report.findings.push({}); }, TypeError);
  assert.throws(() => { report.findings[0].ruleId = 'X'; }, TypeError);
  assert.throws(() => { report.input.assets[0].owner = 'changed'; }, TypeError);
  assert.throws(() => { delete report.summary.countsByRule.NO_APPROVAL; }, TypeError);
});

test('compareSnapshots reports added, removed and unchanged finding keys', () => {
  const golden = run(GOLDEN);
  const clean = run(CLEAN);
  const diff = compareSnapshots(golden, clean);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, golden.findings.map((f) => f.findingId).sort());
  assert.deepEqual(diff.unchanged, []);
  assert.deepEqual(compareSnapshots(golden, golden), { added: [], removed: [], unchanged: golden.findings.map((f) => f.findingId).sort() });
});

test('rule pack is frozen, versioned and carries fictional provenance', () => {
  assert.ok(Object.isFrozen(RULE_PACK));
  assert.equal(RULE_PACK.ruleVersion, 'aqua-review-1');
  assert.deepEqual([...RULE_IDS], ['AMBIGUOUS_APPROVAL', 'NO_APPROVAL', 'OUTSIDE_APPROVAL_WINDOW', 'OWNER_MISSING', 'STALE_OBSERVATION', 'UNKNOWN_ASSET']);
  assert.throws(() => { RULE_PACK.ruleVersion = 'x'; }, TypeError);
});

test('adversarial 7 (partial): URL-like identifiers are plain text and the engine never calls fetch', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('network call attempted'); };
  try {
    const report = run(URL_LIKE);
    assert.deepEqual(report.findings.map((f) => f.ruleId), ['NO_APPROVAL']);
    assert.equal(report.findings[0].observationId, 'http://203.0.113.9/export.json');
    assert.equal(report.findings[0].assetId, 'https://198.51.100.7/plc');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});

test('buildReport refuses unvalidated data', () => {
  assert.throws(() => buildReport({ ...GOLDEN, snapshotAt: 'nope' }), TypeError);
  const parsed = parseInput(fixtureText(GOLDEN));
  assert.equal(buildReport(parsed.data).ok, true);
});
