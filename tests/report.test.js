import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  analyze, createReviewLayer, addNote, recordDecision, notesFor, currentDecision,
  buildExport, serializeExport, parseExport, exportCsv, csvCell, LIMITS, CSV_COLUMNS,
} from '../src/index.js';
import { GOLDEN, GOLDEN_ORACLE, PAYLOADS, fixtureText } from '../fixtures/index.js';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const AT = '2026-11-03T13:00:00Z';

function run(fixture) {
  const r = analyze(fixtureText(fixture), { provenance: 'bundled-synthetic-fixture' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.report;
}

test('notes and decisions live in a separate layer; validation output stays byte-identical', () => {
  const report = run(GOLDEN);
  const before = JSON.stringify(report);
  let layer = createReviewLayer();
  const n1 = addNote(layer, report, { findingId: 'UNKNOWN_ASSET:O3', text: 'Asked vendor for register entry.', author: 'reviewer-1', recordedAt: AT });
  assert.equal(n1.ok, true);
  layer = n1.layer;
  const d1 = recordDecision(layer, report, { findingId: 'UNKNOWN_ASSET:O3', disposition: 'reviewed', reviewer: 'reviewer-1', recordedAt: AT });
  assert.equal(d1.ok, true);
  layer = d1.layer;
  assert.equal(JSON.stringify(report), before);
  assert.equal(report.findings.length, 6, 'original finding never removed');
  assert.ok(!JSON.stringify(report).includes('Asked vendor'));
  assert.equal(notesFor(layer, 'UNKNOWN_ASSET:O3').length, 1);
  assert.equal(currentDecision(layer, 'UNKNOWN_ASSET:O3').disposition, 'reviewed');
  assert.equal(currentDecision(layer, 'NO_APPROVAL:O2'), null);
  assert.ok(Object.isFrozen(layer) && Object.isFrozen(layer.notes));
});

test('review layer is bounded and validated', () => {
  const report = run(GOLDEN);
  const layer = createReviewLayer();
  assert.equal(addNote(layer, report, { findingId: 'UNKNOWN_ASSET:O3', text: 'x'.repeat(LIMITS.maxNoteLength), recordedAt: AT }).ok, true);
  assert.equal(addNote(layer, report, { findingId: 'UNKNOWN_ASSET:O3', text: 'x'.repeat(LIMITS.maxNoteLength + 1), recordedAt: AT }).errors[0].code, 'STRING_TOO_LONG');
  assert.equal(addNote(layer, report, { findingId: 'UNKNOWN_ASSET:O3', text: '   ', recordedAt: AT }).errors[0].code, 'EMPTY_STRING');
  assert.equal(addNote(layer, report, { findingId: 'NOPE:O3', text: 'x', recordedAt: AT }).errors[0].code, 'UNRESOLVED_REFERENCE');
  assert.equal(addNote(layer, report, { findingId: 'UNKNOWN_ASSET:O3', text: 'x', recordedAt: 'today' }).errors[0].code, 'INVALID_TIMESTAMP');
  assert.equal(recordDecision(layer, report, { findingId: 'UNKNOWN_ASSET:O3', disposition: 'closed', recordedAt: AT }).errors[0].code, 'WRONG_TYPE');
  assert.equal(recordDecision(layer, report, { findingId: 'UNKNOWN_ASSET:O3', disposition: 'deferred', reviewer: 'r'.repeat(201), recordedAt: AT }).errors[0].code, 'STRING_TOO_LONG');
});

test('export round trip: stringify, reparse, findings and summary deep-equal the live report', () => {
  const text = fixtureText(GOLDEN);
  const report = run(GOLDEN);
  let layer = createReviewLayer();
  layer = addNote(layer, report, { findingId: 'NO_APPROVAL:O2', text: 'Check path V9.', author: 'r1', recordedAt: AT }).layer;
  layer = recordDecision(layer, report, { findingId: 'NO_APPROVAL:O2', disposition: 'assigned', reviewer: 'r1', recordedAt: AT }).layer;
  const exp = buildExport(report, { generatedAt: AT, sourceHash: sha256(text), notes: layer.notes, decisions: layer.decisions });
  const ser = serializeExport(exp);
  assert.equal(ser.ok, true);
  const back = parseExport(ser.text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.data.findings, report.findings);
  assert.deepEqual(back.data.summary, report.summary);
  assert.deepEqual(back.data.input, report.input);
  assert.equal(back.data.summary.findings, GOLDEN_ORACLE.findings);
  assert.deepEqual(back.data.summary.countsByRule, GOLDEN_ORACLE.countsByRule);
  assert.equal(back.data.sourceHash, sha256(text));
  assert.match(back.data.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(back.data.generatedAt, AT);
  assert.equal(back.data.snapshotAt, '2026-11-03T12:00:00Z');
  assert.equal(back.data.schemaVersion, 'aqua-demo-1');
  assert.equal(back.data.ruleVersion, 'aqua-review-1');
  assert.equal(back.data.dataLabel, 'SYNTHETIC DEMO DATA');
  assert.match(back.data.rulePack.provenance, /Fictional/);
  assert.deepEqual(back.data.notes, layer.notes);
  assert.deepEqual(back.data.decisions, layer.decisions);
  // Human decisions do not rewrite imported evidence.
  assert.deepEqual(back.data.input.observations, [...GOLDEN.observations]);
});

test('buildExport requires injected generatedAt and sourceHash', () => {
  const report = run(GOLDEN);
  assert.throws(() => buildExport(report, { generatedAt: 'now', sourceHash: sha256('x') }), TypeError);
  assert.throws(() => buildExport(report, { generatedAt: AT, sourceHash: 'abc' }), TypeError);
  assert.throws(() => buildExport(report, { generatedAt: AT, sourceHash: sha256('x').toUpperCase() }), TypeError);
});

test('export cap: 10 MiB payload built in memory is rejected with EXPORT_TOO_LARGE', () => {
  const tooBig = { findings: [], summary: {}, filler: 'x'.repeat(LIMITS.maxExportBytes + 1) };
  const r = serializeExport(tooBig);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'EXPORT_TOO_LARGE');
  assert.equal(serializeExport({ a: 1 }).ok, true);
  assert.equal(serializeExport({ a: 1n }).errors[0].code, 'EXPORT_NOT_SERIALIZABLE');
});

test('adversarial 6: payload identifiers survive JSON exactly and CSV neutralizes formula leaders', () => {
  const text = fixtureText(PAYLOADS);
  const report = run(PAYLOADS);
  const exp = buildExport(report, { generatedAt: AT, sourceHash: sha256(text) });
  const back = parseExport(serializeExport(exp).text).data;
  assert.equal(back.input.assets[0].assetId, '<script>alert(1)</script>');
  assert.equal(back.input.assets[1].assetId, '=HYPERLINK("http://192.0.2.1","x")');
  assert.equal(back.input.observations.find((o) => o.observationId === '@cmd').pathId, '-2+3');
  const csv = exportCsv(report);
  assert.equal(csv.ok, true);
  const lines = csv.text.split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  const body = lines.slice(1).filter(Boolean);
  assert.equal(body.length, report.findings.length);
  for (const line of body) {
    for (const cell of line.split(',')) {
      const raw = cell.replace(/^"/, '');
      assert.doesNotMatch(raw, /^[=+\-@\t\r]/, `cell starts with a formula leader: ${cell}`);
    }
  }
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://192.0.2.1"",""x"")"`));
  assert.ok(csv.text.includes("'@cmd"));
  assert.ok(csv.text.includes("'+SUM(A1:A9)"));
  assert.ok(csv.text.includes("'-2+3"));
  assert.ok(csv.text.includes('<script>alert(1)</script>'), 'JSON-exact text is kept; CSV only neutralizes leaders');
});

test('csvCell: RFC 4180 quoting and leader neutralization', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('\tx'), "\"'\tx\"".replace('"\'\tx"', "'\tx"));
  assert.equal(csvCell('\rx'), "\"'\rx\"");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(90000), '90000');
});

test('CSV export carries the synthetic label, decisions and notes', () => {
  const report = run(GOLDEN);
  let layer = createReviewLayer();
  layer = addNote(layer, report, { findingId: 'STALE_OBSERVATION:O5', text: 'Re-pull snapshot, note', recordedAt: AT }).layer;
  layer = recordDecision(layer, report, { findingId: 'STALE_OBSERVATION:O5', disposition: 'deferred', reviewer: 'r2', recordedAt: AT }).layer;
  const csv = exportCsv(report, layer);
  assert.ok(csv.text.startsWith('dataLabel,findingId'));
  const o5 = csv.text.split('\r\n').find((l) => l.includes('STALE_OBSERVATION:O5'));
  assert.ok(o5.startsWith('SYNTHETIC DEMO DATA,'));
  assert.ok(o5.includes(',deferred,r2,"Re-pull snapshot, note"'));
  assert.ok(o5.includes(',90000,'));
});
