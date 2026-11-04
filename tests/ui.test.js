import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { escapeHtml, filterFindings, formatAge, formatBytes, sortErrors, exportFileName, csvCell, emptyFindingsMessage } from '../app/ui.js';
import { analyze } from '../src/index.js';
import { GOLDEN, FIXTURES, fixtureText } from '../fixtures/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('escapeHtml neutralizes markup characters', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("a'b&c"), 'a&#39;b&amp;c');
  assert.equal(escapeHtml(null), '');
  assert.equal(csvCell('=x'), "'=x");
});

test('filterFindings by rule, entity text, unknown assets and missing approvals', () => {
  const { report } = analyze(fixtureText(GOLDEN));
  assert.equal(filterFindings(report.findings).length, 6);
  assert.deepEqual(filterFindings(report.findings, { ruleId: 'NO_APPROVAL' }).map((f) => f.observationId), ['O2', 'O3']);
  assert.deepEqual(filterFindings(report.findings, { query: 'a9' }).map((f) => f.findingId), ['NO_APPROVAL:O3', 'UNKNOWN_ASSET:O3']);
  assert.deepEqual(filterFindings(report.findings, { unknownAssetsOnly: true }).map((f) => f.findingId), ['NO_APPROVAL:O3', 'UNKNOWN_ASSET:O3']);
  assert.deepEqual(filterFindings(report.findings, { missingApprovalOnly: true, query: 'O2' }).map((f) => f.findingId), ['NO_APPROVAL:O2']);
  assert.equal(filterFindings(report.findings, { ruleId: 'AMBIGUOUS_APPROVAL' }).length, 0);
});

test('formatters are pure and bounded', () => {
  assert.equal(formatAge(90000), '25 h 00 m');
  assert.equal(formatAge(3600), '1 h 00 m');
  assert.equal(formatAge(86401), '24 h 00 m 01 s');
  assert.equal(formatAge(-1), 'n/a');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1048576), '1.00 MiB');
  assert.equal(exportFileName('2026-11-03T13:00:00Z', 'json'), 'aquasentinel-synthetic-20261103T130000Z.json');
  assert.deepEqual(sortErrors([{ path: 'b', code: 'X' }, { path: 'a', code: 'Y' }]).map((e) => e.path), ['a', 'b']);
});

test('emptyFindingsMessage distinguishes no records, zero gaps and filtered-out', () => {
  const empty = analyze(fixtureText(FIXTURES.empty.data)).report.summary;
  const clean = analyze(fixtureText(FIXTURES.clean.data)).report.summary;
  const golden = analyze(fixtureText(GOLDEN)).report.summary;
  assert.match(emptyFindingsMessage(empty, 0), /zero observations/);
  assert.match(emptyFindingsMessage(clean, 0), /Zero evidence gaps/);
  assert.notEqual(emptyFindingsMessage(empty, 0), emptyFindingsMessage(clean, 0));
  assert.equal(emptyFindingsMessage(golden, 0), 'No findings match the current filters.');
  assert.equal(emptyFindingsMessage(golden, 6), null);
});

test('UI fixtures all parse through the real engine', () => {
  for (const f of Object.values(FIXTURES)) {
    const r = analyze(fixtureText(f.data));
    assert.equal(r.ok, true, `${f.name}: ${JSON.stringify(r.errors)}`);
  }
});

test('app scripts parse (node --check) and contain no innerHTML-with-data, eval, fetch or external URLs', () => {
  for (const file of ['app/app.js', 'app/ui.js', 'scripts/serve.mjs']) {
    const r = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
  }
  const app = readFileSync(join(root, 'app/app.js'), 'utf8');
  assert.doesNotMatch(app, /innerHTML\s*=\s*[^'"`\s]/, 'innerHTML must only be assigned literal empty strings');
  assert.doesNotMatch(app, /\beval\s*\(|new Function|fetch\s*\(|XMLHttpRequest|WebSocket/);
  for (const html of ['app/index.html', 'index.html']) {
    const text = readFileSync(join(root, html), 'utf8');
    assert.doesNotMatch(text, /https?:\/\/(?!www\.w3\.org)/, `${html} references an external URL`);
    assert.match(text, /synthetic/i, `${html} must carry the synthetic banner`);
  }
});
