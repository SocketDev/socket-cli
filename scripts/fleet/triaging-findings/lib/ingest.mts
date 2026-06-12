/**
 * Phase-1b field normalization for the triaging-findings skill: turn a raw
 * scanner record into a canonical finding dict via the source-key alias map,
 * assign ingest-order ids, compute missing_fields, and emit the fixed
 * unlocatable envelope for a finding with no resolvable `file`.
 *
 * Pure + exported. The alias TABLE and the unlocatable CONSTANT lived as prose
 * in the SKILL; here they are a typed record + a function, so the normalization
 * can't drift by hand and the "never emit a confident verdict on an unlocatable
 * finding" rule is code. The input-shape detection (1a), path resolution (1c),
 * and the agent-driven phases stay in the skill.
 */

// Canonical field → the source keys that alias onto it. Order within a list is
// preference: the first present alias wins.
export const FIELD_ALIASES: Record<string, string[]> = {
  category: ['category', 'type', 'cwe', 'rule_id', 'crash_type', 'vuln_class'],
  description: ['description', 'details', 'report', 'body', 'evidence'],
  exploit_scenario: ['exploit_scenario', 'attack_scenario', 'poc', 'reproduction'],
  file: ['file', 'path', 'filename'],
  line: ['line', 'line_number', 'lineno'],
  preconditions: ['preconditions', 'requirements', 'assumptions'],
  recommendation: ['recommendation', 'fix', 'remediation', 'mitigation'],
  scanner_confidence: ['scanner_confidence', 'confidence', 'score', 'certainty'],
  severity: ['severity', 'severity_rating', 'level', 'priority', 'risk'],
  title: ['title', 'name', 'summary', 'message'],
}

// Nested-key aliases (dotted) handled separately so the table stays flat.
const NESTED_ALIASES: Record<string, string[]> = {
  file: ['location.file'],
  line: ['location.line'],
}

// The canonical fields whose absence is recorded in missing_fields.
const TRACKED_FIELDS = Object.keys(FIELD_ALIASES)

export interface RawRecord {
  [key: string]: unknown
}

export interface Finding {
  id: string
  source: string
  file?: string | undefined
  line?: number | undefined
  category?: string | undefined
  severity?: string | undefined
  title?: string | undefined
  description?: string | undefined
  exploit_scenario?: string | undefined
  preconditions?: string[] | undefined
  recommendation?: string | undefined
  scanner_confidence?: number | undefined
  missing_fields: string[]
  // Set on an unlocatable finding (no resolvable file).
  verdict?: string | undefined
  verify_verdict?: string | undefined
  confidence?: number | undefined
  refute_reasons?: string[] | undefined
  rationale?: string | undefined
}

function getNested(record: RawRecord, dotted: string): unknown {
  const parts = dotted.split('.')
  let cur: unknown = record
  for (let i = 0, { length } = parts; i < length; i += 1) {
    if (cur === null || typeof cur !== 'object') {
      return undefined
    }
    cur = (cur as Record<string, unknown>)[parts[i]!]
  }
  return cur
}

// The first present alias value for a canonical field, or undefined.
export function pullField(
  record: RawRecord,
  canonical: string,
): unknown {
  const aliases = FIELD_ALIASES[canonical] ?? [canonical]
  for (let i = 0, { length } = aliases; i < length; i += 1) {
    const v = record[aliases[i]!]
    if (v !== undefined && v !== null && v !== '') {
      return v
    }
  }
  for (const dotted of NESTED_ALIASES[canonical] ?? []) {
    const v = getNested(record, dotted)
    if (v !== undefined && v !== null && v !== '') {
      return v
    }
  }
  return undefined
}

// Normalize a scanner confidence/score/certainty to 0.0-1.0. A value already in
// [0,1] is kept; a 1-10 or 1-100 scale is scaled down; anything else clamps.
export function normalizeConfidence(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return undefined
  }
  if (raw <= 1) {
    return Math.max(0, raw)
  }
  if (raw <= 10) {
    return Math.round((raw / 10) * 100) / 100
  }
  if (raw <= 100) {
    return Math.round((raw / 100) * 100) / 100
  }
  return 1
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') {
    return v
  }
  if (typeof v === 'number') {
    return String(v)
  }
  return undefined
}

function asLine(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string' && /^\d+$/u.test(v.trim())) {
    return Number(v.trim())
  }
  return undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string')
  }
  const s = asString(v)
  return s === undefined ? undefined : [s]
}

// Normalize one raw record into a finding (Phase 1b), with the given id +
// source. Pulls each canonical field via the alias map and records which
// tracked fields were absent.
export function normalizeRecord(
  record: RawRecord,
  id: string,
  source: string,
): Finding {
  const file = asString(pullField(record, 'file'))
  const line = asLine(pullField(record, 'line'))
  const category = asString(pullField(record, 'category'))
  const severity = asString(pullField(record, 'severity'))
  const title = asString(pullField(record, 'title'))
  const description = asString(pullField(record, 'description'))
  const exploit_scenario = asString(pullField(record, 'exploit_scenario'))
  const preconditions = asStringArray(pullField(record, 'preconditions'))
  const recommendation = asString(pullField(record, 'recommendation'))
  const scanner_confidence = normalizeConfidence(
    pullField(record, 'scanner_confidence'),
  )
  const values: Record<string, unknown> = {
    category,
    description,
    exploit_scenario,
    file,
    line,
    preconditions,
    recommendation,
    scanner_confidence,
    severity,
    title,
  }
  const missing_fields = TRACKED_FIELDS.filter(
    f => values[f] === undefined,
  ).toSorted()
  return {
    category,
    description,
    exploit_scenario,
    file,
    id,
    line,
    missing_fields,
    preconditions,
    recommendation,
    scanner_confidence,
    severity,
    source,
    title,
  }
}

// The fixed unlocatable envelope (Phase 1b): a finding with no resolvable file
// is emitted directly with this verdict and never enters dedup/verification. A
// constant shape so a confident verdict is never emitted on a finding we
// couldn't locate.
export function unlocatableEnvelope(finding: Finding): Finding {
  return {
    ...finding,
    confidence: 0,
    rationale:
      'no source location in input; cannot verify statically; human review required',
    refute_reasons: ['doesnt_exist'],
    verdict: 'false_positive',
    verify_verdict: 'needs_manual_test',
  }
}

export function isUnlocatable(finding: Finding): boolean {
  return finding.file === undefined || finding.file === ''
}

// Assign ingest-order ids f001.. to raw records. When scanner_confidence is
// present on MOST records, order ingest by it descending (a scheduling prior
// only — it does not affect verdicts); else keep source order.
export function ingestOrder(records: readonly RawRecord[]): RawRecord[] {
  const withConf = records.filter(
    r => normalizeConfidence(pullField(r, 'scanner_confidence')) !== undefined,
  )
  if (withConf.length * 2 <= records.length) {
    return [...records]
  }
  return [...records].toSorted((a, b) => {
    const ca = normalizeConfidence(pullField(a, 'scanner_confidence')) ?? -1
    const cb = normalizeConfidence(pullField(b, 'scanner_confidence')) ?? -1
    return cb - ca
  })
}

// Normalize a list of raw records into findings (Phase 1b end-to-end): order,
// assign ids, normalize, and wrap unlocatables in the fixed envelope.
export function ingest(
  records: readonly RawRecord[],
  source: string,
): Finding[] {
  const ordered = ingestOrder(records)
  return ordered.map((record, i) => {
    const id = `f${String(i + 1).padStart(3, '0')}`
    const finding = normalizeRecord(record, id, source)
    return isUnlocatable(finding) ? unlocatableEnvelope(finding) : finding
  })
}
