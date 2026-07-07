/**
 * Deterministic collate/score/render math for the scanning-vulns skill —
 * everything in Steps 3, 3b-Resolve, 4, and 5 that is arithmetic + templating,
 * not judgment. The review + confidence agents (Steps 2, 3b) stay prose; their
 * structured findings flow through here so the dedupe rule, id assignment,
 * score normalization, summary counts, and the two output renderings can never
 * drift by hand (the same fabricated-count / line-handling risk the sibling
 * triaging-findings avoids by owning its math in code).
 *
 * Pure + exported — every function is unit-testable in isolation.
 */

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW'

export interface Finding {
  id?: string | undefined
  file: string
  line?: number | undefined
  category: string
  severity: Severity
  confidence: number
  title: string
  description: string
  exploit_scenario?: string | undefined
  recommendation?: string | undefined
  confidence_reason?: string | undefined
}

export interface VulnFindings {
  target: string
  scanned_at: string
  focus_areas: string[]
  findings: Finding[]
  summary: {
    total: number
    high: number
    medium: number
    low: number
    low_confidence: number
  }
}

export interface Score {
  id: string
  confidence: number
  reason?: string | undefined
}

const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, LOW: 2, MEDIUM: 1 }

// ASCII string compare (JS `<`/`>` on strings IS code-unit order — the fleet's
// stringComparator semantics) for the file tiebreak.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Count the non-empty / non-placeholder findings. A focus-area agent that found
// nothing returns an empty list (or a single placeholder with no file); those
// are dropped before collation (Step 3.1).
export function dropEmpty(findings: readonly Finding[]): Finding[] {
  return findings.filter(f => Boolean(f?.file && f.title))
}

// Light dedupe (Step 3.2): two findings at the same file:line with the same
// category collapse to one — keep the longer description, count the drop. NOT
// the heavy semantic dedupe (that's triaging-findings' job).
export function lightDedupe(findings: readonly Finding[]): {
  findings: Finding[]
  duplicates: number
} {
  const byKey = new Map<string, Finding>()
  let duplicates = 0
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const key = `${f.file}:${f.line ?? ''}:${f.category.toLowerCase()}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, f)
      continue
    }
    duplicates += 1
    if (f.description.length > existing.description.length) {
      byKey.set(key, f)
    }
  }
  return { duplicates, findings: [...byKey.values()] }
}

// The Step 3 sort + id assignment: (severity desc, file, line) order, ids
// F-001, F-002, … in that order. Mutates a copy, returns it.
export function assignIds(findings: readonly Finding[]): Finding[] {
  const sorted = [...findings].toSorted((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (sev !== 0) {
      return sev
    }
    const file = compareStrings(a.file, b.file)
    if (file !== 0) {
      return file
    }
    return (a.line ?? 0) - (b.line ?? 0)
  })
  return sorted.map((f, i) => ({ ...f, id: `F-${String(i + 1).padStart(3, '0')}` }))
}

// Normalize a 1-10 confidence score to 0.0-1.0 (Step 3b-Resolve). Clamps out of
// range and rounds to 2 decimals so the JSON is stable.
export function normalizeScore(score1to10: number): number {
  const clamped = Math.max(1, Math.min(10, score1to10))
  return Math.round((clamped / 10) * 100) / 100
}

// Apply per-finding scores (Step 3b-Resolve): overwrite confidence with the
// normalized score + attach confidence_reason, then re-sort by (confidence desc,
// severity desc, file, line) and reassign ids. A finding with no score keeps its
// existing confidence.
export function applyScores(
  findings: readonly Finding[],
  scores: readonly Score[],
): Finding[] {
  const byId = new Map(scores.map(s => [s.id, s]))
  const scored = findings.map(f => {
    const s = f.id ? byId.get(f.id) : undefined
    if (!s) {
      return f
    }
    return {
      ...f,
      confidence: normalizeScore(s.confidence),
      confidence_reason: s.reason,
    }
  })
  const sorted = scored.toSorted((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence
    }
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (sev !== 0) {
      return sev
    }
    const file = compareStrings(a.file, b.file)
    if (file !== 0) {
      return file
    }
    return (a.line ?? 0) - (b.line ?? 0)
  })
  return sorted.map((f, i) => ({ ...f, id: `F-${String(i + 1).padStart(3, '0')}` }))
}

// Count findings below the low-confidence threshold (Step 3b-Resolve).
export function lowConfidenceCount(
  findings: readonly Finding[],
  threshold = 0.4,
): number {
  return findings.filter(f => f.confidence < threshold).length
}

// Build the VULN-FINDINGS.json envelope (Step 4) with computed summary counts.
export function buildEnvelope(input: {
  target: string
  scannedAt: string
  focusAreas: readonly string[]
  findings: readonly Finding[]
}): VulnFindings {
  const findings = [...input.findings]
  let high = 0
  let medium = 0
  let low = 0
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const sev = findings[i]!.severity
    if (sev === 'HIGH') {
      high += 1
    } else if (sev === 'MEDIUM') {
      medium += 1
    } else {
      low += 1
    }
  }
  return {
    findings,
    focus_areas: [...input.focusAreas],
    scanned_at: input.scannedAt,
    summary: {
      high,
      low,
      low_confidence: lowConfidenceCount(findings),
      medium,
      total: findings.length,
    },
    target: input.target,
  }
}

function severityBadge(sev: Severity): string {
  return sev
}

// Render the human-readable VULN-FINDINGS.md (Step 4): a summary table then one
// `### F-NNN` section per finding.
export function renderMarkdown(env: VulnFindings): string {
  const lines: string[] = []
  lines.push(`# Vulnerability findings — ${env.target}`)
  lines.push('')
  lines.push(
    `Scanned ${env.scanned_at} · ${env.summary.total} findings (${env.summary.high} high / ${env.summary.medium} medium / ${env.summary.low} low; ${env.summary.low_confidence} low-confidence) across ${env.focus_areas.length} focus area(s).`,
  )
  lines.push('')
  lines.push('| id | severity | category | file:line | title |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (let i = 0, { length } = env.findings; i < length; i += 1) {
    const f = env.findings[i]!
    const loc = f.line === undefined ? f.file : `${f.file}:${f.line}`
    lines.push(
      `| ${f.id ?? '?'} | ${severityBadge(f.severity)} | ${f.category} | ${loc} | ${f.title} |`,
    )
  }
  lines.push('')
  for (let i = 0, { length } = env.findings; i < length; i += 1) {
    const f = env.findings[i]!
    const loc = f.line === undefined ? f.file : `${f.file}:${f.line}`
    lines.push(`### ${f.id ?? '?'} — ${f.title}`)
    lines.push('')
    lines.push(
      `- **severity**: ${f.severity}  **confidence**: ${f.confidence}  **location**: \`${loc}\`  **category**: ${f.category}`,
    )
    lines.push('')
    lines.push(f.description)
    if (f.exploit_scenario) {
      lines.push('')
      lines.push(`**Exploit scenario**: ${f.exploit_scenario}`)
    }
    if (f.recommendation) {
      lines.push('')
      lines.push(`**Recommendation**: ${f.recommendation}`)
    }
    if (f.confidence_reason) {
      lines.push('')
      lines.push(`**Confidence**: ${f.confidence_reason}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

// The Step 5 hand-back summary: the counts line + the top-3-by-confidence.
export function summarizeHandback(
  env: VulnFindings,
  sourceFileCount: number,
): string {
  const s = env.summary
  const lines: string[] = []
  lines.push(
    `${s.total} finding(s) — ${s.high} high / ${s.medium} medium / ${s.low} low (${s.low_confidence} low-confidence), across ${env.focus_areas.length} focus area(s), from ${sourceFileCount} source file(s).`,
  )
  const top = env.findings.slice(0, 3)
  for (let i = 0, { length } = top; i < length; i += 1) {
    const f = top[i]!
    const loc = f.line === undefined ? f.file : `${f.file}:${f.line}`
    lines.push(`  ${f.id ?? '?'} (${f.confidence}) ${f.title} — ${loc}`)
  }
  return lines.join('\n')
}
