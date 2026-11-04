# AquaSentinel — synthetic vertical slice

> **SYNTHETIC DEMO DATA ONLY.** Every fixture describes a fictional water utility with fictional assets, approvals and observations. The rule pack `aqua-review-1` is fictional and illustrative; its only source is the slice specification. Nothing here is a security assessment, a compliance check, or a statement about any real infrastructure. It carries **no legal, regulatory, clinical or operational authority**. A missing observation never implies safety; a finding never implies exposure, severity or compromise.

## Purpose

AquaSentinel imports one JSON envelope containing three registers (assets, approvals, observations) and deterministically lists where the records disagree with each other. It is a **passive** reconciliation of imported evidence: there is no scan, fetch, DNS lookup, device connection, PLC write, telemetry collection or remediation anywhere in the code. URL-like identifiers are treated as opaque text.

The engine in `src/` is dependency-free Node 24 ESM with no `node:` imports, no clock and no network, so the same modules run unchanged in the browser workbench.

## Running

| Command | What it does |
|---|---|
| `npm test` (= `node --test "tests/**/*.test.js"`) | Runs the oracle, boundary, adversarial, report/export and UI-helper tests. |
| `npm run serve` (= `node scripts/serve.mjs [port]`) | Serves this directory on **127.0.0.1 only** (default port 4173). `/` is the landing page, `/app/` is the workbench. Stop it with Ctrl-C. |

No `npm install` is needed; `dependencies` and `devDependencies` are empty.

## Input contract (`schemaVersion` `aqua-demo-1`)

```json
{
  "schemaVersion": "aqua-demo-1",
  "ruleVersion": "aqua-review-1",
  "snapshotAt": "2026-11-03T12:00:00Z",
  "assets":       [{ "assetId": "A1", "owner": "Ops" }, { "assetId": "A2", "owner": null }],
  "approvals":    [{ "approvalId": "P1", "assetId": "A1", "pathId": "V1", "validFrom": "2026-11-01T00:00:00Z", "validThrough": "2026-11-04T00:00:00Z" }],
  "observations": [{ "observationId": "O1", "assetId": "A1", "pathId": "V1", "observedAt": "2026-11-03T11:00:00Z" }]
}
```

- `ruleVersion` is optional; if present it must be `aqua-review-1`. Unknown envelope or record keys are rejected.
- Identifiers are opaque, case-sensitive strings. Surrounding ASCII whitespace is trimmed at parse time only; a collision introduced by trimming (`"O1"` vs `" O1 "`) is rejected (`WHITESPACE_COLLISION`), as are duplicates (`DUPLICATE_ID`). No alias guessing, port inference or merging by name.
- `owner` is a nonempty string or `null`. Approvals must reference an existing `assetId`; observations may reference unknown assets (valid input, reported as `UNKNOWN_ASSET`).
- Timestamps must be real UTC calendar instants in `YYYY-MM-DDTHH:MM:SSZ` form; `validFrom <= validThrough`; `observedAt <= snapshotAt`.
- Bounds: 1 MiB input, 1,000 assets, 2,000 approvals, 5,000 observations, 200-character identifiers, 2,000-character notes, nesting depth 8, 10 MiB export. NUL bytes or undecodable text are rejected as `UNEXPECTED_BINARY`.
- Validation is **atomic**: any error returns `{ ok: false, errors: [{ code, path, message }] }` with every row/field problem found and no partial data. In the workbench the previous dataset is preserved.

## Rule pack `aqua-review-1` (fictional)

Per observation, rules run independently: `UNKNOWN_ASSET` (assetId absent from register), `NO_APPROVAL` (no approval for the exact `(assetId, pathId)`), otherwise `OUTSIDE_APPROVAL_WINDOW` (no approval covers `observedAt`, inclusive endpoints) or `AMBIGUOUS_APPROVAL` (more than one covers it, emitted once), `OWNER_MISSING` (known asset with `owner: null`), `STALE_OBSERVATION` (`snapshotAt - observedAt > 86,400 s`; exactly 86,400 s is not stale). Finding keys are `RULE_ID:observationId`, sorted lexicographically by `(observationId, ruleId)`. All counters use checked safe-integer arithmetic.

## Output

`analyze(text, { provenance })` returns `{ ok: true, report }` where `report` is **deeply frozen** and contains `reportVersion` (`2`), `provenance`, `dataLabel`, `dataNotice`, `syntheticNotice`, `schemaVersion`, `ruleVersion`, `rulePack` (version, provenance text, stale threshold, rule IDs), `limits`, `snapshotAt`, the normalized sorted `input`, per-observation rows (`ageSeconds`, `assetKnown`, `flagged`, `ruleIds`), `findings` (each with `message`, `details` and `evidence: { observation, asset, approvals }`), and `summary` (counts, `countsByRule`, `ageSecondsByObservation`).

### Data provenance

`provenance` is chosen by the **calling code path**, never read from the input text. The input schema rejects unknown keys, so a JSON field such as `"dataLabel"`, `"provenance"` or `"synthetic"` is rejected with `UNKNOWN_KEY` rather than honoured.

| `provenance` | `dataLabel` | `syntheticNotice` | Used by |
|---|---|---|---|
| `bundled-synthetic-fixture` | `SYNTHETIC DEMO DATA` | the synthetic notice | the workbench fixture loader only |
| `unverified-user-supplied` (default) | `UNVERIFIED USER-SUPPLIED DATA` | `null` | local JSON file, pasted JSON, and any caller that passes nothing |

Any other value throws `TypeError`. Loading a fixture and then pressing "Validate and run" on the (editable) text box is deliberately labelled unverified. The label records how data entered the page; it does not detect or prevent real data, and accepted input stays in the tab (no network call).

A separate review layer (`createReviewLayer`, `addNote`, `recordDecision`) holds notes and dispositions (`open`, `reviewed`, `assigned`, `deferred`) without ever modifying the report. `compareSnapshots(a, b)` diffs finding keys between two reports.

## Exports

- **JSON** (`buildExport` + `serializeExport`): `exportVersion` (`2`), `provenance`, `dataLabel`, `dataNotice`, `syntheticNotice`, versions, rule-pack provenance, caller-supplied `generatedAt` and `sourceHash` (SHA-256 hex of the raw input text), snapshot, input, summary, observations, findings, notes, decisions. Exact identifiers are preserved. 10 MiB cap.
- **CSV** (`exportCsv`): one row per finding; the first column `dataLabel` carries the report's provenance label; then disposition, reviewer and notes; RFC 4180 quoting; cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to neutralize spreadsheet formulas. 10 MiB cap.

### Contract versions and compatibility

- Unchanged: input `schemaVersion` `aqua-demo-1`, rule pack `ruleVersion` `aqua-review-1`, rule logic, findings, summary.
- `reportVersion` 1 → 2 and `exportVersion` 1 → 2, because `dataLabel` changed meaning (it was always `SYNTHETIC DEMO DATA`; it now depends on provenance).
- v2 is additive for JSON readers: every v1 key is still present with the same type except `syntheticNotice`, which is now `null` for unverified data so an old reader never sees a false synthetic claim. New keys: `provenance`, `dataNotice`.
- CSV header and column order are unchanged; only the `dataLabel` cell value can differ.
- A report object without `provenance` (v1 shape) is exported as unverified. Existing v1 export files are not rewritten; their `SYNTHETIC DEMO DATA` label is not evidence of provenance.
- `analyze(text)` with no option now labels the result unverified (it previously said synthetic). Callers wanting the synthetic label must pass `{ provenance: 'bundled-synthetic-fixture' }`, and should only do so for bundled fixtures.

## Workbench (`/app/`)

Static HTML plus ESM modules that import the real engine: load a labelled synthetic fixture, choose a local JSON file, or paste JSON (file and pasted data are shown, in the banner, status line and exports, as unverified user-supplied data); see validation errors or the frozen report's counts; filter findings by rule, entity text, unknown assets or missing approvals; open a finding to see the observation, asset and approval records behind it plus its independent sibling findings; add notes and record dispositions; compare with the previously imported snapshot; export JSON and safe CSV. The DOM is built with `createElement`/`textContent` only; there is no `innerHTML` with data, no `eval`, no network call, and no external fonts, scripts or URLs. The server sets a `connect-src 'none'` content security policy.

## Limitations (explicit)

- Bundled fixtures are synthetic. The workbench also accepts any local JSON that passes the schema; such data is labelled unverified user-supplied data, but nothing stops someone from entering real records. Not validated against any real utility, standard, regulation or threat model, and not suitable for one.
- The workbench has **not** been exercised by automated browser tests in this repository; only the pure helpers (`app/ui.js`), the engine and static checks of `app/app.js` and the HTML are tested. The blocked-network evidence, independent oracle check, security review and accessibility review named in the specification's release gate have not been performed here.
- The review layer and compare state live in page memory only; reloading the page discards them. There is no persistence, authentication, tenant isolation or access control.
- JSON export requires `crypto.subtle` (available on `127.0.0.1` in modern browsers) for the source hash; if absent, the UI says so and refuses to export without a hash.
- Only `schemaVersion` `aqua-demo-1` and `ruleVersion` `aqua-review-1` are accepted; there is no migration path for other versions.
- The project's own tests are the author's tests, not an independent audit.
