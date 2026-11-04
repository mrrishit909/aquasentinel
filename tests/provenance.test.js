// Provenance labelling: bundled fixtures are synthetic; anything else is unverified user-supplied data.
// Provenance is chosen by the calling code path and can never be self-asserted by the input JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  analyze, buildExport, serializeExport, parseExport, exportCsv, CSV_COLUMNS,
  FIXTURE_PROVENANCE, USER_PROVENANCE, SYNTHETIC_NOTICE, UNVERIFIED_NOTICE, SCHEMA_VERSION, RULE_VERSION,
} from '../src/index.js';
import { GOLDEN, fixtureText } from '../fixtures/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const AT = '2026-11-03T13:00:00Z';
const SYN = 'SYNTHETIC DEMO DATA';
const UNV = 'UNVERIFIED USER-SUPPLIED DATA';

// Arbitrary imported envelope, not one of the bundled fixtures.
const IMPORTED_TEXT = JSON.stringify({
  schemaVersion: 'aqua-demo-1',
  snapshotAt: '2026-11-03T12:00:00Z',
  assets: [{ assetId: 'PUMP-7', owner: 'Plant team' }],
  approvals: [],
  observations: [{ observationId: 'X1', assetId: 'PUMP-7', pathId: 'P-1', observedAt: '2026-11-03T11:00:00Z' }],
});

function exportBoth(text, options) {
  const r = analyze(text, options);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const json = serializeExport(buildExport(r.report, { generatedAt: AT, sourceHash: sha256(text) }));
  assert.equal(json.ok, true);
  const csv = exportCsv(r.report);
  assert.equal(csv.ok, true);
  return { report: r.report, data: parseExport(json.text).data, jsonText: json.text, csvText: csv.text };
}

test('versions: schema and rule versions unchanged; report and export contracts are v2', () => {
  assert.equal(SCHEMA_VERSION, 'aqua-demo-1');
  assert.equal(RULE_VERSION, 'aqua-review-1');
  const { report, data } = exportBoth(fixtureText(GOLDEN), { provenance: FIXTURE_PROVENANCE });
  assert.equal(report.reportVersion, 2);
  assert.equal(data.exportVersion, 2);
});

test('bundled fixture path: JSON and CSV exports are labelled synthetic', () => {
  const { report, data, csvText } = exportBoth(fixtureText(GOLDEN), { provenance: FIXTURE_PROVENANCE });
  assert.equal(report.provenance, FIXTURE_PROVENANCE);
  assert.equal(report.dataLabel, SYN);
  assert.equal(data.provenance, FIXTURE_PROVENANCE);
  assert.equal(data.dataLabel, SYN);
  assert.equal(data.dataNotice, SYNTHETIC_NOTICE);
  assert.equal(data.syntheticNotice, SYNTHETIC_NOTICE);
  const rows = csvText.split('\r\n').filter(Boolean).slice(1);
  assert.equal(rows.length, 6);
  for (const row of rows) assert.ok(row.startsWith(`${SYN},`), row);
});

test('arbitrary imported path: JSON and CSV exports are labelled unverified, never synthetic', () => {
  const { report, data, jsonText, csvText } = exportBoth(IMPORTED_TEXT, { provenance: USER_PROVENANCE });
  assert.equal(report.provenance, USER_PROVENANCE);
  assert.equal(report.dataLabel, UNV);
  assert.equal(report.syntheticNotice, null);
  assert.equal(data.provenance, USER_PROVENANCE);
  assert.equal(data.dataLabel, UNV);
  assert.equal(data.dataNotice, UNVERIFIED_NOTICE);
  assert.equal(data.syntheticNotice, null);
  assert.ok(!jsonText.includes(SYN), 'imported JSON export must not contain the synthetic label');
  assert.ok(!csvText.includes(SYN), 'imported CSV export must not contain the synthetic label');
  const lines = csvText.split('\r\n').filter(Boolean);
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith(`${UNV},`), lines[1]);
});

test('no option means unverified: the exact bundled fixture bytes are not promoted to synthetic', () => {
  const { report, data, csvText } = exportBoth(fixtureText(GOLDEN));
  assert.equal(report.dataLabel, UNV);
  assert.equal(data.dataLabel, UNV);
  assert.ok(!csvText.includes(SYN));
});

test('input JSON cannot self-assert provenance: label-like keys are rejected, never honoured', () => {
  const attempts = [
    { ...GOLDEN, dataLabel: SYN },
    { ...GOLDEN, provenance: FIXTURE_PROVENANCE },
    { ...GOLDEN, syntheticNotice: SYNTHETIC_NOTICE },
    { ...GOLDEN, synthetic: true },
    { ...GOLDEN, assets: [{ ...GOLDEN.assets[0], provenance: FIXTURE_PROVENANCE }, GOLDEN.assets[1]] },
  ];
  for (const envelope of attempts) {
    for (const provenance of [undefined, USER_PROVENANCE]) {
      const r = analyze(JSON.stringify(envelope), { provenance });
      assert.equal(r.ok, false);
      assert.equal(r.report, undefined);
      assert.ok(r.errors.some((e) => e.code === 'UNKNOWN_KEY'), JSON.stringify(r.errors));
    }
  }
});

test('provenance option accepts only the two known keys', () => {
  for (const bad of ['synthetic', SYN, 'BUNDLED-SYNTHETIC-FIXTURE', true, 1, null, {}]) {
    assert.throws(() => analyze(fixtureText(GOLDEN), { provenance: bad }), TypeError, String(bad));
  }
});

test('backward compatibility: a report without provenance (reportVersion 1 shape) exports as unverified', () => {
  const { report } = exportBoth(fixtureText(GOLDEN), { provenance: FIXTURE_PROVENANCE });
  const { provenance, ...legacy } = report;
  const data = buildExport({ ...legacy, reportVersion: 1, dataLabel: SYN }, { generatedAt: AT, sourceHash: sha256('x') });
  assert.equal(data.dataLabel, UNV);
  assert.equal(data.syntheticNotice, null);
  assert.ok(exportCsv({ ...legacy, dataLabel: SYN }).text.split('\r\n')[1].startsWith(`${UNV},`));
});

test('workbench wiring: only the fixture loader passes fixture provenance; file and paste pass unverified', () => {
  const app = readFileSync(join(root, 'app/app.js'), 'utf8');
  const fixtureUses = app.match(/runImport\([^;]*FIXTURE_PROVENANCE\)/g) ?? [];
  assert.equal(fixtureUses.length, 1);
  assert.match(fixtureUses[0], /Fixture/);
  assert.match(app, /runImport\(text, `File[^;]*USER_PROVENANCE\)/);
  assert.match(app, /runImport\(\$\('input-text'\)\.value, 'Pasted text', USER_PROVENANCE\)/);
  assert.equal((app.match(/runImport\(/g) ?? []).length, 4, 'one definition plus three call sites');
});
