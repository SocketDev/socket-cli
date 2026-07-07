/**
 * Output assembly for the triaging-findings skill's final phase: the
 * verdict/severity sort, the TRIAGE.json envelope with computed summary counts
 * AND the every-finding-once invariant enforced as an assertion (a dropped or
 * duplicated id throws), and the terminal summary line.
 *
 * Pure + exported. The sort comparator, the summary arithmetic, and the "every
 * input finding appears exactly once" rule lived as prose; encoding them here
 * makes the invariant a thrown error instead of a hope, and the counts can't be
 * fabricated. The verifier votes, severity derivation, and rationale prose stay
 * agent-driven — this only assembles their structured output.
 */

export type Verdict = 'true_positive' | 'false_positive' | 'duplicate'
export type SevLabel = 'HIGH' | 'MEDIUM' | 'LOW'

export interface TriagedFinding {
  id: string
  verdict: Verdict
  severity?: SevLabel | null | undefined
  confidence?: number | undefined
  severity_alignment?: number | undefined
  verify_verdict?: string | null | undefined
  duplicate_of?: string | null | undefined
  [key: string]: unknown
}

const VERDICT_RANK: Record<Verdict, number> = {
  duplicate: 1,
  false_positive: 2,
  true_positive: 0,
}

const SEV_RANK: Record<SevLabel, number> = { HIGH: 0, LOW: 2, MEDIUM: 1 }

// Order findings verdict-first (true_positive, then duplicate, then
// false_positive); within true positives by severity (HIGH>MEDIUM>LOW), then
// confidence desc, then severity_alignment desc; others fall back to id order.
// Stable + pure.
export function sortFindings(
  findings: readonly TriagedFinding[],
): TriagedFinding[] {
  return [...findings].toSorted((a, b) => {
    const v = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]
    if (v !== 0) {
      return v
    }
    if (a.verdict === 'true_positive') {
      const sa = a.severity ? SEV_RANK[a.severity] : 3
      const sb = b.severity ? SEV_RANK[b.severity] : 3
      if (sa !== sb) {
        return sa - sb
      }
      const ca = a.confidence ?? 0
      const cb = b.confidence ?? 0
      if (cb !== ca) {
        return cb - ca
      }
      const aa = a.severity_alignment ?? 0
      const ab = b.severity_alignment ?? 0
      if (ab !== aa) {
        return ab - aa
      }
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export interface TriageSummary {
  input_count: number
  duplicates: number
  false_positives: number
  true_positives: number
  needs_manual_test: number
  by_severity: { HIGH: number; MEDIUM: number; LOW: number }
}

export function computeSummary(
  findings: readonly TriagedFinding[],
  inputCount: number,
): TriageSummary {
  let duplicates = 0
  let falsePositives = 0
  let truePositives = 0
  let needsManualTest = 0
  const bySeverity = { HIGH: 0, LOW: 0, MEDIUM: 0 }
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    if (f.verdict === 'duplicate') {
      duplicates += 1
    } else if (f.verdict === 'false_positive') {
      falsePositives += 1
    } else {
      truePositives += 1
      if (f.severity) {
        bySeverity[f.severity] += 1
      }
    }
    if (f.verify_verdict === 'needs_manual_test') {
      needsManualTest += 1
    }
  }
  return {
    by_severity: bySeverity,
    duplicates,
    false_positives: falsePositives,
    input_count: inputCount,
    needs_manual_test: needsManualTest,
    true_positives: truePositives,
  }
}

// Enforce the every-finding-once invariant: every input id appears in the output
// exactly once. A duplicated or dropped id is a triage bug — throw with a
// fix-shaped message rather than emit a silently-lossy report.
export function assertEveryFindingOnce(
  findings: readonly TriagedFinding[],
  inputIds: readonly string[],
): void {
  const seen = new Map<string, number>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const id = findings[i]!.id
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  const duped = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  if (duped.length) {
    throw new Error(
      `TRIAGE.json invariant violated: id(s) ${duped.join(', ')} appear more than once. Every input finding must appear exactly once; merge the duplicate records.`,
    )
  }
  const inputSet = new Set(inputIds)
  const outputSet = new Set(seen.keys())
  const dropped = [...inputSet].filter(id => !outputSet.has(id))
  if (dropped.length) {
    throw new Error(
      `TRIAGE.json invariant violated: input id(s) ${dropped.join(', ')} are missing from the output. Every input finding must appear exactly once (a duplicate references duplicate_of); never silently drop one.`,
    )
  }
  const extra = [...outputSet].filter(id => !inputSet.has(id))
  if (extra.length) {
    throw new Error(
      `TRIAGE.json invariant violated: output id(s) ${extra.join(', ')} were not in the input. The triage must not invent findings.`,
    )
  }
}

export interface TriageEnvelope {
  triage_completed: true
  triage_context: Record<string, unknown>
  summary: TriageSummary
  findings: TriagedFinding[]
}

// Build the TRIAGE.json envelope: sort, compute the summary, and assert the
// every-finding-once invariant. `inputIds` is the full set of ingest ids —
// passing it is what makes the invariant enforceable.
export function buildTriageEnvelope(input: {
  context: Record<string, unknown>
  findings: readonly TriagedFinding[]
  inputIds: readonly string[]
}): TriageEnvelope {
  const sorted = sortFindings(input.findings)
  assertEveryFindingOnce(sorted, input.inputIds)
  return {
    findings: sorted,
    summary: computeSummary(sorted, input.inputIds.length),
    triage_completed: true,
    triage_context: input.context,
  }
}

// The terminal summary (under ~12 lines): counts, severity split, top HIGH +
// owner, needs-manual-test count.
export function terminalSummary(env: TriageEnvelope): string {
  const s = env.summary
  const lines: string[] = []
  lines.push(
    `${s.input_count} in → ${s.duplicates} duplicate, ${s.false_positives} false positive, ${s.true_positives} confirmed.`,
  )
  lines.push(
    `Confirmed by severity: ${s.by_severity.HIGH} HIGH / ${s.by_severity.MEDIUM} MEDIUM / ${s.by_severity.LOW} LOW.`,
  )
  const topHigh = env.findings.find(
    f => f.verdict === 'true_positive' && f.severity === 'HIGH',
  )
  if (topHigh) {
    const owner =
      typeof topHigh['owner_hint'] === 'string'
        ? topHigh['owner_hint']
        : '(no owner)'
    lines.push(`Top HIGH: ${String(topHigh['title'] ?? topHigh.id)} — ${owner}.`)
  }
  lines.push(`${s.needs_manual_test} need manual test.`)
  return lines.join('\n')
}
