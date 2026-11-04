import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseInput, validate, LIMITS, measureDepth, trimAscii, parseUtcTimestamp, checkedAdd, checkedDifference, analyze } from '../src/index.js';
import { GOLDEN, DUPLICATE_ASSET, DUPLICATE_APPROVAL, WHITESPACE_COLLISION, BAD_TIMESTAMPS, fixtureText } from '../fixtures/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const codes = (result) => result.errors.map((e) => e.code);
const paths = (result) => result.errors.map((e) => e.path);

test('src/ is isomorphic: no node: imports, no fetch, no eval', () => {
  const dir = join(here, '..', 'src');
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    assert.doesNotMatch(text, /from\s+['"]node:/, `${file} imports node:`);
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\beval\s*\(|new Function|Date\.now/, `${file} uses a forbidden API`);
  }
});

test('parseInput accepts the golden fixture text and returns trimmed data', () => {
  const r = parseInput(fixtureText(GOLDEN));
  assert.equal(r.ok, true);
  assert.equal(r.data.schemaVersion, 'aqua-demo-1');
  assert.equal(r.data.observations.length, 5);
});

test('rejects non-text, root not object, unknown envelope keys, missing keys', () => {
  assert.deepEqual(codes(parseInput(42)), ['INPUT_NOT_TEXT']);
  assert.deepEqual(codes(parseInput('[]')), ['ROOT_NOT_OBJECT']);
  assert.deepEqual(codes(parseInput('"x"')), ['ROOT_NOT_OBJECT']);
  const r = parseInput(JSON.stringify({ ...GOLDEN, extra: 1 }));
  assert.deepEqual(codes(r), ['UNKNOWN_KEY']);
  assert.deepEqual(paths(r), ['$.extra']);
  const { observations, ...missing } = GOLDEN;
  assert.ok(codes(parseInput(JSON.stringify(missing))).includes('MISSING_KEY'));
});

test('rejects unknown schemaVersion and ruleVersion', () => {
  assert.deepEqual(codes(parseInput(JSON.stringify({ ...GOLDEN, schemaVersion: 'aqua-demo-2' }))), ['UNSUPPORTED_SCHEMA_VERSION']);
  assert.deepEqual(codes(parseInput(JSON.stringify({ ...GOLDEN, ruleVersion: 'aqua-review-9' }))), ['UNSUPPORTED_RULE_VERSION']);
  assert.equal(parseInput(JSON.stringify({ ...GOLDEN, ruleVersion: 'aqua-review-1' })).ok, true);
});

test('adversarial 8: malformed JSON, binary/archive, oversize, over-limit rows and deep nesting reject without partial state', () => {
  assert.deepEqual(codes(parseInput('{"schemaVersion": ')), ['INVALID_JSON']);
  assert.deepEqual(codes(parseInput('PK\u0003\u0004\u0000\u0000binary')), ['UNEXPECTED_BINARY']);
  const big = fixtureText(GOLDEN).replace('"assets"', `"${'x'.repeat(LIMITS.maxInputBytes)}"`);
  const oversize = parseInput(big);
  assert.deepEqual(codes(oversize), ['INPUT_TOO_LARGE']);
  assert.equal(oversize.data, undefined);
  // Multi-byte characters count as UTF-8 bytes, not code units.
  const multibyte = 'é'.repeat(LIMITS.maxInputBytes / 2 + 1);
  assert.deepEqual(codes(parseInput(multibyte)), ['INPUT_TOO_LARGE']);
  const deep = `${'['.repeat(LIMITS.maxDepth + 1)}${']'.repeat(LIMITS.maxDepth + 1)}`;
  assert.deepEqual(codes(parseInput(deep)), ['NESTING_TOO_DEEP']);
  const deepInside = JSON.stringify({ ...GOLDEN, assets: [{ assetId: 'A1', owner: JSON.parse(`${'['.repeat(9)}${']'.repeat(9)}`) }] });
  assert.deepEqual(codes(parseInput(deepInside)), ['NESTING_TOO_DEEP']);
  assert.equal(measureDepth(JSON.parse(fixtureText(GOLDEN))), 3);
  const tooMany = { ...GOLDEN, observations: Array.from({ length: LIMITS.maxObservations + 1 }, (_, i) => ({ observationId: `X${i}`, assetId: 'A1', pathId: 'V1', observedAt: '2026-11-03T11:00:00Z' })) };
  const r = parseInput(JSON.stringify(tooMany));
  assert.deepEqual(codes(r), ['TOO_MANY_ROWS']);
  assert.equal(r.data, undefined);
  const tooManyAssets = { ...GOLDEN, assets: Array.from({ length: LIMITS.maxAssets + 1 }, (_, i) => ({ assetId: `A${i}`, owner: null })) };
  assert.deepEqual(codes(parseInput(JSON.stringify(tooManyAssets))), ['TOO_MANY_ROWS']);
  const tooManyApprovals = { ...GOLDEN, approvals: Array.from({ length: LIMITS.maxApprovals + 1 }, (_, i) => ({ approvalId: `P${i}`, assetId: 'A1', pathId: 'V1', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-02T00:00:00Z' })) };
  assert.deepEqual(codes(parseInput(JSON.stringify(tooManyApprovals))), ['TOO_MANY_ROWS']);
});

test('adversarial 1: duplicate IDs and whitespace collisions reject atomically with row paths', () => {
  const dupAsset = parseInput(fixtureText(DUPLICATE_ASSET));
  assert.deepEqual(codes(dupAsset), ['DUPLICATE_ID']);
  assert.deepEqual(paths(dupAsset), ['$.assets[2].assetId']);
  const dupApproval = parseInput(fixtureText(DUPLICATE_APPROVAL));
  assert.deepEqual(codes(dupApproval), ['DUPLICATE_ID']);
  assert.deepEqual(paths(dupApproval), ['$.approvals[2].approvalId']);
  const ws = parseInput(fixtureText(WHITESPACE_COLLISION));
  assert.deepEqual(codes(ws), ['WHITESPACE_COLLISION']);
  assert.deepEqual(paths(ws), ['$.observations[5].observationId']);
  assert.equal(ws.data, undefined);
  // Trimming is ASCII-only and preserves case: 'a1' is a distinct asset from 'A1'.
  const cased = parseInput(JSON.stringify({ ...GOLDEN, assets: [...GOLDEN.assets, { assetId: 'a1', owner: 'x' }] }));
  assert.equal(cased.ok, true);
  assert.equal(trimAscii(' \tA1\r\n'), 'A1');
  assert.equal(trimAscii(' A1'), ' A1');
  const trimmed = parseInput(JSON.stringify({ ...GOLDEN, assets: [{ assetId: '  A1 ', owner: 'Ops' }, { assetId: 'A2', owner: null }] }));
  assert.equal(trimmed.ok, true);
  assert.equal(trimmed.data.assets[0].assetId, 'A1');
});

test('adversarial 2: invalid calendar date, missing zone, offset, future observation, reversed interval reject with field paths', () => {
  const r = parseInput(fixtureText(BAD_TIMESTAMPS));
  assert.equal(r.ok, false);
  const byPath = Object.fromEntries(r.errors.map((e) => [e.path, e.code]));
  assert.equal(byPath['$.approvals[0].validThrough'], 'REVERSED_INTERVAL');
  assert.equal(byPath['$.observations[0].observedAt'], 'INVALID_TIMESTAMP');
  assert.equal(byPath['$.observations[1].observedAt'], 'INVALID_TIMESTAMP');
  assert.equal(byPath['$.observations[2].observedAt'], 'INVALID_TIMESTAMP');
  assert.equal(byPath['$.observations[3].observedAt'], 'FUTURE_OBSERVATION');
  assert.equal(r.errors.length, 5);
});

test('timestamps: strict format, leap years, UTC comparison', () => {
  assert.equal(parseUtcTimestamp('2026-11-03T12:00:00Z'), Date.UTC(2026, 10, 3, 12) / 1000);
  assert.equal(parseUtcTimestamp('2024-02-29T00:00:00Z') !== null, true);
  assert.equal(parseUtcTimestamp('2026-02-29T00:00:00Z'), null);
  assert.equal(parseUtcTimestamp('2100-02-29T00:00:00Z'), null);
  assert.equal(parseUtcTimestamp('2000-02-29T00:00:00Z') !== null, true);
  assert.equal(parseUtcTimestamp('2026-04-31T00:00:00Z'), null);
  assert.equal(parseUtcTimestamp('2026-11-03T24:00:00Z'), null);
  assert.equal(parseUtcTimestamp('2026-11-03T12:00:00.000Z'), null);
  assert.equal(parseUtcTimestamp('2026-11-03T12:00:00'), null);
  assert.equal(parseUtcTimestamp('2026-11-03T12:00:00+00:00'), null);
  assert.equal(parseUtcTimestamp(' 2026-11-03T12:00:00Z'), null);
  assert.equal(parseUtcTimestamp('2026-13-01T00:00:00Z'), null);
  assert.equal(parseUtcTimestamp('2026-00-10T00:00:00Z'), null);
});

test('field-level type and bound errors', () => {
  const r = validate({
    ...GOLDEN,
    assets: [
      { assetId: 'A1', owner: '' },
      { assetId: 'A2', owner: 7 },
      { assetId: 'A3' },
      { assetId: 'A4', owner: null, extra: true },
      { assetId: 'x'.repeat(201), owner: null },
      { assetId: '   ', owner: null },
      { assetId: 5, owner: null },
    ],
    approvals: [{ approvalId: 'P1', assetId: 'A9', pathId: 'V1', validFrom: '2026-11-01T00:00:00Z', validThrough: '2026-11-02T00:00:00Z' }],
    observations: ['not-an-object'],
  });
  assert.equal(r.ok, false);
  const byPath = Object.fromEntries(r.errors.map((e) => [e.path, e.code]));
  assert.equal(byPath['$.assets[0].owner'], 'EMPTY_STRING');
  assert.equal(byPath['$.assets[1].owner'], 'WRONG_TYPE');
  assert.equal(byPath['$.assets[2].owner'], 'MISSING_KEY');
  assert.equal(byPath['$.assets[3].extra'], 'UNKNOWN_KEY');
  assert.equal(byPath['$.assets[4].assetId'], 'STRING_TOO_LONG');
  assert.equal(byPath['$.assets[5].assetId'], 'EMPTY_STRING');
  assert.equal(byPath['$.assets[6].assetId'], 'WRONG_TYPE');
  assert.equal(byPath['$.approvals[0].assetId'], 'UNRESOLVED_REFERENCE');
  assert.equal(byPath['$.observations[0]'], 'WRONG_TYPE');
  assert.equal(validate(null).errors[0].code, 'ROOT_NOT_OBJECT');
  assert.equal(validate({ ...GOLDEN, assets: {} }).errors[0].code, 'WRONG_TYPE');
});

test('checked integer helpers reject overflow, negatives, fractions and NaN', () => {
  assert.deepEqual(checkedAdd(1, 2), { ok: true, value: 3 });
  assert.equal(checkedAdd(Number.MAX_SAFE_INTEGER, 1).code, 'INTEGER_OVERFLOW');
  assert.equal(checkedAdd(1, -1).code, 'INTEGER_OVERFLOW');
  assert.equal(checkedAdd(1, 0.5).code, 'INTEGER_OVERFLOW');
  assert.equal(checkedAdd(NaN, 1).code, 'INTEGER_OVERFLOW');
  assert.equal(checkedAdd(1, Infinity).code, 'INTEGER_OVERFLOW');
  assert.equal(checkedDifference(5, 6).code, 'INTEGER_UNDERFLOW');
  assert.deepEqual(checkedDifference(6, 5), { ok: true, value: 1 });
});

test('any error means no partial report and previously loaded state untouched', () => {
  const good = analyze(fixtureText(GOLDEN));
  assert.equal(good.ok, true);
  const snapshot = JSON.stringify(good.report);
  const bad = analyze(fixtureText(DUPLICATE_ASSET));
  assert.equal(bad.ok, false);
  assert.equal(bad.report, undefined);
  assert.equal(JSON.stringify(good.report), snapshot);
});
