// Public surface of the AquaSentinel engine. Pure, isomorphic ESM.
export { TIMESTAMP_PATTERN, isLeapYear, daysInMonth, parseUtcTimestamp, formatUtcTimestamp } from './dates.js';
export { OverflowError, checkedAdd, checkedDifference, addOrThrow, differenceOrThrow, isNonNegativeSafeInteger } from './integers.js';
export {
  SCHEMA_VERSION,
  RULE_VERSION,
  LIMITS,
  ERROR_CODES,
  trimAscii,
  utf8ByteLength,
  measureDepth,
  validate,
  parseInput,
} from './schema.js';
export { RULE_PACK, RULE_IDS, STALE_THRESHOLD_SECONDS, pairKey, findingIdFor, evaluateObservation } from './rules.js';
export { analyze, buildReport, compareSnapshots, compareFindings } from './engine.js';
export {
  SYNTHETIC_NOTICE,
  DISPOSITIONS,
  deepFreeze,
  createReviewLayer,
  addNote,
  recordDecision,
  notesFor,
  currentDecision,
  buildExport,
  serializeExport,
  parseExport,
  csvCell,
  CSV_COLUMNS,
  buildCsvRows,
  exportCsv,
} from './report.js';
