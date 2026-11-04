// Browser entry for the AquaSentinel synthetic workbench. Wires the REAL engine in src/ to the DOM.
// Safety rules: DOM is built with createElement/textContent only (no innerHTML with data), no eval,
// no network calls of any kind. Everything runs on the imported text in this tab. Bundled fixtures are labelled
// synthetic; a local file or pasted text is labelled unverified user-supplied data. Provenance comes from which
// control was used (code path), never from anything inside the JSON.
import {
  analyze,
  compareSnapshots,
  RULE_PACK,
  RULE_IDS,
  LIMITS,
  SCHEMA_VERSION,
  RULE_VERSION,
  FIXTURE_PROVENANCE,
  USER_PROVENANCE,
  reportProvenance,
  DISPOSITIONS,
  createReviewLayer,
  addNote,
  recordDecision,
  notesFor,
  currentDecision,
  buildExport,
  serializeExport,
  exportCsv,
  utf8ByteLength,
} from '../src/index.js';
import { filterFindings, formatAge, formatBytes, sortErrors, exportFileName, emptyFindingsMessage } from './ui.js';
import { FIXTURES, fixtureText } from '../fixtures/index.js';

const $ = (id) => document.getElementById(id);

/** createElement helper. Text always goes through textContent / text nodes. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function sha256Hex(text) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const state = {
  report: null,
  previousReport: null,
  layer: createReviewLayer(),
  sourceText: '',
  sourceHash: null,
  sourceBytes: 0,
  selectedFindingId: null,
  invoker: null, // the button that opened the evidence panel; focus returns here on close
  focusPanel: false,
};

/** Open the evidence panel for a finding. Enter on a finding button triggers click natively. */
function openFinding(findingId, invoker) {
  state.selectedFindingId = findingId;
  state.invoker = invoker || null;
  state.focusPanel = true;
  renderFindings();
  renderEvidence();
  $('evidence').scrollIntoView({ block: 'nearest' });
}

/** Close the evidence panel and return focus to the button that opened it (WCAG 2.4.3). */
function closeEvidence() {
  if (!state.selectedFindingId) return;
  const back = state.invoker;
  state.selectedFindingId = null;
  state.invoker = null;
  renderFindings();
  renderEvidence();
  if (back && back.isConnected) back.focus();
  else $('findings-h').focus();
}

// ---------- status / errors ----------

function setStatus(message, tone = 'neutral') {
  const node = $('import-status');
  node.textContent = message;
  node.dataset.tone = tone;
}

function renderErrors(errors) {
  const list = $('error-list');
  clear(list);
  $('errors').hidden = errors.length === 0;
  for (const e of sortErrors(errors)) {
    list.append(el('li', {}, [el('code', { text: e.code }), ' ', el('code', { class: 'path', text: e.path }), ' ', el('span', { text: e.message })]));
  }
}

// ---------- import ----------

async function runImport(text, sourceLabel, provenance) {
  const result = analyze(text, { provenance });
  if (!result.ok) {
    renderErrors(result.errors);
    setStatus(`${sourceLabel} rejected atomically with ${result.errors.length} error(s). Previous dataset preserved.`, 'bad');
    return;
  }
  state.previousReport = state.report;
  state.report = result.report;
  state.sourceText = text;
  state.sourceBytes = utf8ByteLength(text);
  state.sourceHash = await sha256Hex(text);
  state.layer = createReviewLayer();
  state.selectedFindingId = null;
  renderErrors([]);
  renderAll();
  const hash = state.sourceHash ? `sha256 ${state.sourceHash.slice(0, 16)}…` : 'sha256 unavailable in this browser context';
  setStatus(`${sourceLabel} accepted as ${state.report.dataLabel}: ${formatBytes(state.sourceBytes)}, ${hash}. Frozen report built with ${RULE_VERSION}.`, 'good');
}

function loadFixture() {
  const key = $('fixture-select').value;
  const fixture = FIXTURES[key];
  if (!fixture) return;
  const text = fixtureText(fixture.data);
  $('input-text').value = text;
  runImport(text, `Fixture "${fixture.name}"`, FIXTURE_PROVENANCE);
}

async function loadFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > LIMITS.maxInputBytes) {
    renderErrors([{ code: 'INPUT_TOO_LARGE', path: '$', message: `file is ${file.size} bytes; the limit is ${LIMITS.maxInputBytes} bytes` }]);
    setStatus(`File "${file.name}" rejected before reading: over the ${formatBytes(LIMITS.maxInputBytes)} limit.`, 'bad');
    event.target.value = '';
    return;
  }
  const text = await file.text();
  $('input-text').value = text;
  await runImport(text, `File "${file.name}"`, USER_PROVENANCE);
  event.target.value = '';
}

// ---------- rendering ----------

const NO_DATA_NOTICE =
  'No dataset loaded. Bundled fixtures are synthetic demo data; a local JSON file or pasted JSON is shown as unverified user-supplied data. ' +
  'Labels describe how data was loaded; they do not detect or prevent real data.';

function renderProvenance() {
  const report = state.report;
  const banner = $('data-banner');
  banner.dataset.provenance = report ? report.provenance : 'none';
  banner.textContent = report ? report.dataNotice : NO_DATA_NOTICE;
  $('notice').textContent = report ? report.dataNotice : NO_DATA_NOTICE;
}

function renderAll() {
  renderProvenance();
  renderSummary();
  renderFindings();
  renderEvidence();
  renderCompare();
  $('export-status').textContent = '';
  const has = state.report !== null;
  for (const id of ['export-json', 'export-csv']) $(id).disabled = !has;
  $('workbench').dataset.loaded = has ? 'yes' : 'no';
}

function stat(label, value) {
  return el('div', { class: 'stat' }, [el('dt', { text: label }), el('dd', { text: String(value) })]);
}

function renderSummary() {
  const grid = $('summary-grid');
  const rules = $('rule-counts');
  clear(grid);
  clear(rules);
  const report = state.report;
  if (!report) {
    $('snapshot-line').textContent = 'No dataset loaded. Load a synthetic fixture, or pick a JSON file or paste JSON (shown as unverified user-supplied data).';
    return;
  }
  const s = report.summary;
  $('snapshot-line').textContent = `snapshotAt ${report.snapshotAt} · schema ${report.schemaVersion} · rules ${report.ruleVersion} · ${report.dataLabel}`;
  grid.append(
    stat('Assets', s.assets),
    stat('Approvals', s.approvals),
    stat('Observations', s.observations),
    stat('Flagged observations', s.flaggedObservations),
    stat('Structurally consistent', s.structurallyConsistentObservations),
    stat('Unknown-asset observations', s.unknownAssetObservations),
    stat('Findings (evidence gaps)', s.findings),
  );
  for (const ruleId of RULE_IDS) {
    const rule = RULE_PACK.rules.find((r) => r.ruleId === ruleId);
    rules.append(
      el('li', {}, [
        el('span', { class: 'count', text: String(s.countsByRule[ruleId]) }),
        el('code', { text: ruleId }),
        el('span', { class: 'muted', text: rule ? rule.title : '' }),
      ]),
    );
  }
}

function currentFilters() {
  return {
    ruleId: $('filter-rule').value,
    query: $('filter-query').value,
    unknownAssetsOnly: $('filter-unknown').checked,
    missingApprovalOnly: $('filter-missing').checked,
  };
}

function renderFindings() {
  const body = $('findings-body');
  clear(body);
  const report = state.report;
  if (!report) {
    $('findings-count').textContent = '';
    return;
  }
  const shown = filterFindings(report.findings, currentFilters());
  $('findings-count').textContent = `${shown.length} of ${report.findings.length} findings shown`;
  const emptyMessage = emptyFindingsMessage(report.summary, shown.length);
  if (emptyMessage) {
    body.append(el('tr', {}, el('td', { colspan: '8', class: 'muted', 'data-state': report.summary.observations === 0 ? 'no-records' : report.findings.length === 0 ? 'zero-findings' : 'filtered', text: emptyMessage })));
    return;
  }
  for (const f of shown) {
    const decision = currentDecision(state.layer, f.findingId);
    const button = el('button', { type: 'button', class: 'link', text: 'Evidence', 'aria-label': `Evidence for ${f.findingId}` });
    button.addEventListener('click', () => openFinding(f.findingId, button));
    const row = el('tr', { class: f.findingId === state.selectedFindingId ? 'selected' : '' }, [
      el('td', {}, el('code', { text: f.findingId })),
      el('td', {}, el('code', { text: f.ruleId })),
      el('td', { text: f.observationId }),
      el('td', { text: f.assetId }),
      el('td', { text: f.pathId }),
      el('td', { text: formatAge(report.summary.ageSecondsByObservation[f.observationId]) }),
      el('td', { text: decision ? decision.disposition : 'open' }),
      el('td', {}, button),
    ]);
    body.append(row);
  }
}

function field(label, value) {
  return el('div', { class: 'field' }, [el('dt', { text: label }), el('dd', { text: value === null || value === undefined ? '—' : String(value) })]);
}

function renderEvidence() {
  const panel = $('evidence-body');
  clear(panel);
  const report = state.report;
  const finding = report ? report.findings.find((f) => f.findingId === state.selectedFindingId) : null;
  $('review').hidden = !finding;
  if (!finding) {
    panel.append(el('p', { class: 'muted', text: 'Select a finding to see the imported records that produced it.' }));
    return;
  }
  const rule = RULE_PACK.rules.find((r) => r.ruleId === finding.ruleId);
  const heading = el('h3', { tabindex: '-1', id: 'evidence-title' }, el('code', { text: finding.findingId }));
  const close = el('button', { type: 'button', class: 'close', text: 'Close (Esc)', 'aria-label': `Close evidence for ${finding.findingId}` });
  close.addEventListener('click', closeEvidence);
  panel.append(
    el('div', { class: 'row between' }, [heading, close]),
    el('p', { class: 'message', text: finding.message }),
    el('p', { class: 'muted', text: `${finding.ruleId} (${finding.ruleVersion}): ${rule ? rule.description : ''}` }),
  );
  if (state.focusPanel) {
    state.focusPanel = false;
    heading.focus({ preventScroll: true });
  }

  const obs = finding.evidence.observation;
  panel.append(el('h4', { text: 'Observation record' }));
  panel.append(
    el('dl', { class: 'fields' }, [
      field('observationId', obs.observationId),
      field('assetId', obs.assetId),
      field('pathId', obs.pathId),
      field('observedAt', obs.observedAt),
      field('age vs snapshot', formatAge(report.summary.ageSecondsByObservation[obs.observationId])),
    ]),
  );

  panel.append(el('h4', { text: 'Asset register entry' }));
  const asset = finding.evidence.asset;
  panel.append(
    asset
      ? el('dl', { class: 'fields' }, [field('assetId', asset.assetId), field('owner', asset.owner === null ? 'null (no owner recorded)' : asset.owner)])
      : el('p', { class: 'muted', text: 'This assetId is not present in assets[]. Unknown observed assets are valid input and are recorded as an evidence gap, never as exposure.' }),
  );

  panel.append(el('h4', { text: `Approvals considered (${finding.evidence.approvals.length})` }));
  if (finding.evidence.approvals.length === 0) {
    panel.append(el('p', { class: 'muted', text: 'No approval record was used by this rule.' }));
  } else {
    const list = el('ul', { class: 'approvals' });
    for (const a of finding.evidence.approvals) {
      list.append(el('li', {}, [el('code', { text: a.approvalId }), ` ${a.assetId} / ${a.pathId}: ${a.validFrom} → ${a.validThrough} (inclusive)`]));
    }
    panel.append(list);
  }

  if (Object.keys(finding.details).length > 0) {
    panel.append(el('h4', { text: 'Rule details' }));
    panel.append(el('pre', { text: JSON.stringify(finding.details, null, 2) }));
  }

  const siblings = report.findings.filter((f) => f.observationId === finding.observationId && f.findingId !== finding.findingId);
  if (siblings.length > 0) {
    panel.append(el('h4', { text: 'Other independent findings for this observation' }));
    const list = el('ul');
    for (const s of siblings) {
      const b = el('button', { type: 'button', class: 'link', text: s.findingId });
      b.addEventListener('click', () => openFinding(s.findingId, state.invoker));
      list.append(el('li', {}, b));
    }
    panel.append(list);
  }

  renderReview(finding);
}

function renderReview(finding) {
  const decision = currentDecision(state.layer, finding.findingId);
  $('decision-current').textContent = decision
    ? `Current disposition: ${decision.disposition}${decision.reviewer ? ` (reviewer ${decision.reviewer})` : ''} at ${decision.recordedAt}. The original finding stays in the report.`
    : 'Current disposition: open (no decision recorded).';
  const notes = $('note-list');
  clear(notes);
  for (const n of notesFor(state.layer, finding.findingId)) {
    notes.append(el('li', {}, [el('span', { class: 'muted', text: `${n.recordedAt}${n.author ? ` · ${n.author}` : ''}: ` }), el('span', { text: n.text })]));
  }
  if (notes.childElementCount === 0) notes.append(el('li', { class: 'muted', text: 'No notes yet.' }));
}

function onAddNote() {
  if (!state.selectedFindingId) return;
  const author = $('note-author').value.trim();
  const result = addNote(state.layer, state.report, {
    findingId: state.selectedFindingId,
    text: $('note-text').value,
    author: author.length > 0 ? author : null,
    recordedAt: nowUtc(),
  });
  if (!result.ok) {
    $('review-status').textContent = result.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join('; ');
    return;
  }
  state.layer = result.layer;
  $('note-text').value = '';
  $('review-status').textContent = 'Note recorded in the review layer (not in the imported evidence).';
  renderEvidence();
}

function onRecordDecision() {
  if (!state.selectedFindingId) return;
  const reviewer = $('decision-reviewer').value.trim();
  const result = recordDecision(state.layer, state.report, {
    findingId: state.selectedFindingId,
    disposition: $('decision-select').value,
    reviewer: reviewer.length > 0 ? reviewer : null,
    recordedAt: nowUtc(),
  });
  if (!result.ok) {
    $('review-status').textContent = result.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join('; ');
    return;
  }
  state.layer = result.layer;
  $('review-status').textContent = 'Disposition recorded; the finding remains in the frozen report.';
  renderFindings();
  renderEvidence();
}

function renderCompare() {
  const node = $('compare-body');
  clear(node);
  if (!state.report || !state.previousReport) {
    node.append(el('p', { class: 'muted', text: 'Import a second valid dataset to compare its finding keys with the previous one.' }));
    return;
  }
  const diff = compareSnapshots(state.previousReport, state.report);
  node.append(
    el('p', { text: `Previous snapshot ${state.previousReport.snapshotAt} (${state.previousReport.dataLabel}) → current ${state.report.snapshotAt} (${state.report.dataLabel})` }),
    el('dl', { class: 'fields' }, [
      field('added', `${diff.added.length}${diff.added.length ? `: ${diff.added.join(', ')}` : ''}`),
      field('removed', `${diff.removed.length}${diff.removed.length ? `: ${diff.removed.join(', ')}` : ''}`),
      field('unchanged', `${diff.unchanged.length}${diff.unchanged.length ? `: ${diff.unchanged.join(', ')}` : ''}`),
    ]),
  );
}

// ---------- export ----------

function download(text, fileName, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onExportJson() {
  if (!state.report) return;
  if (!state.sourceHash) {
    $('export-status').textContent = 'JSON export needs the SHA-256 source hash, which this browser context did not provide.';
    return;
  }
  const generatedAt = nowUtc();
  let exportObject;
  try {
    exportObject = buildExport(state.report, {
      generatedAt,
      sourceHash: state.sourceHash,
      notes: state.layer.notes,
      decisions: state.layer.decisions,
    });
  } catch (e) {
    $('export-status').textContent = `Export refused: ${e.message}`;
    return;
  }
  const result = serializeExport(exportObject);
  if (!result.ok) {
    $('export-status').textContent = result.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
    return;
  }
  download(result.text, exportFileName(generatedAt, 'json', reportProvenance(state.report)), 'application/json');
  $('export-status').textContent = `JSON export written (${formatBytes(result.bytes)}; exact identifiers preserved; includes sourceHash, snapshot, rule version, findings, notes, decisions).`;
}

function onExportCsv() {
  if (!state.report) return;
  const result = exportCsv(state.report, state.layer);
  if (!result.ok) {
    $('export-status').textContent = result.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
    return;
  }
  download(result.text, exportFileName(nowUtc(), 'csv', reportProvenance(state.report)), 'text/csv');
  $('export-status').textContent = `CSV export written (${formatBytes(result.bytes)}; formula-leading cells neutralized with a leading apostrophe).`;
}

// ---------- boot ----------

function populateStatic() {
  const select = $('fixture-select');
  for (const f of Object.values(FIXTURES)) select.append(el('option', { value: f.name, text: f.label }));
  const ruleSelect = $('filter-rule');
  ruleSelect.append(el('option', { value: '', text: 'All rules' }));
  for (const ruleId of RULE_IDS) ruleSelect.append(el('option', { value: ruleId, text: ruleId }));
  const dispositions = $('decision-select');
  for (const d of DISPOSITIONS) dispositions.append(el('option', { value: d, text: d }));
  $('meta-versions').textContent = `schemaVersion ${SCHEMA_VERSION} · ruleVersion ${RULE_VERSION} · stale threshold ${RULE_PACK.staleThresholdSeconds} s`;
  $('meta-provenance').textContent = RULE_PACK.provenance;
  $('meta-limits').textContent = `Limits: ${formatBytes(LIMITS.maxInputBytes)} input, ${LIMITS.maxAssets} assets, ${LIMITS.maxApprovals} approvals, ${LIMITS.maxObservations} observations, ${LIMITS.maxIdentifierLength}-character identifiers, ${LIMITS.maxNoteLength}-character notes, nesting depth ${LIMITS.maxDepth}, ${formatBytes(LIMITS.maxExportBytes)} export.`;
}

function boot() {
  populateStatic();
  $('load-fixture').addEventListener('click', loadFixture);
  $('input-file').addEventListener('change', loadFile);
  // The text box is user-editable, so this path is always unverified, even if a fixture filled it.
  $('run-text').addEventListener('click', () => runImport($('input-text').value, 'Pasted text', USER_PROVENANCE));
  for (const id of ['filter-rule', 'filter-query', 'filter-unknown', 'filter-missing']) $(id).addEventListener('input', renderFindings);
  $('note-add').addEventListener('click', onAddNote);
  $('decision-record').addEventListener('click', onRecordDecision);
  $('export-json').addEventListener('click', onExportJson);
  $('export-csv').addEventListener('click', onExportCsv);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedFindingId) closeEvidence();
  });
  renderAll();
  setStatus('Ready. Nothing leaves this page; the engine runs on the text you import.', 'neutral');
}

boot();
