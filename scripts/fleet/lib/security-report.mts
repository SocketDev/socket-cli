/**
 * @file The deterministic grade + HANDOFF owner for the scanning-security
 *   skill. The A-F rubric and the === HANDOFF === envelope shape are documented
 *   in _shared/report-format.md; encoding them once here (not in skill prose)
 *   means the count→letter mapping and the parser-facing envelope can never
 *   drift from the doc, and a check can assert computeGrade against the table.
 *   The agent assigns severities (judgment); this turns the resulting counts
 *   into the grade + envelope (arithmetic + templating).
 */

import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface FindingCounts {
  critical: number
  high: number
  medium: number
  low: number
}

// The A-F security grade from finding counts, encoding report-format.md exactly:
//   A: 0 critical, 0 high
//   B: 0 critical, 1-3 high
//   C: 0 critical, 4+ high  OR  exactly 1 critical
//   D: 2-3 critical
//   F: 4+ critical
export function computeGrade(counts: FindingCounts): Grade {
  const { critical, high } = counts
  if (critical >= 4) {
    return 'F'
  }
  if (critical >= 2) {
    return 'D'
  }
  if (critical === 1) {
    return 'C'
  }
  // critical === 0 from here.
  if (high >= 4) {
    return 'C'
  }
  if (high >= 1) {
    return 'B'
  }
  return 'A'
}

export interface HandoffInput {
  skill: string
  status: 'pass' | 'fail'
  counts: FindingCounts
  summary: string
  grade?: Grade | undefined
}

// The === HANDOFF === block a pipeline parent reads to gate. The grade is
// computed from counts when not supplied, so caller + envelope can't disagree.
export function renderHandoff(input: HandoffInput): string {
  const grade = input.grade ?? computeGrade(input.counts)
  const { critical, high, low, medium } = input.counts
  return [
    `=== HANDOFF: ${input.skill} ===`,
    `Status: ${input.status}`,
    `Grade: ${grade}`,
    `Findings: {critical: ${critical}, high: ${high}, medium: ${medium}, low: ${low}}`,
    `Summary: ${input.summary}`,
    '=== END HANDOFF ===',
  ].join('\n')
}

function readCounts(fromPath: string | undefined): FindingCounts {
  if (!fromPath) {
    throw new Error(
      'no --from <counts.json> given. Write the assigned-severity counts as {critical,high,medium,low} JSON and pass --from <file>.',
    )
  }
  const parsed: unknown = JSON.parse(readFileSync(fromPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${fromPath} is not a JSON object of counts.`)
  }
  const o = parsed as Record<string, unknown>
  const num = (k: string): number =>
    typeof o[k] === 'number' ? (o[k] as number) : 0
  return {
    critical: num('critical'),
    high: num('high'),
    low: num('low'),
    medium: num('medium'),
  }
}

function optValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

export function main(argv: readonly string[]): number {
  const sub = argv[0]
  const rest = argv.slice(1)
  if (sub === 'grade') {
    const counts = readCounts(optValue(rest, '--from'))
    process.stdout.write(`${computeGrade(counts)}\n`)
    return 0
  }
  if (sub === 'handoff') {
    const fromPath = optValue(rest, '--from')
    if (!fromPath) {
      process.stderr.write('handoff: --from <envelope.json> is required\n')
      return 1
    }
    const env = JSON.parse(readFileSync(fromPath, 'utf8')) as HandoffInput
    process.stdout.write(`${renderHandoff(env)}\n`)
    return 0
  }
  process.stderr.write(
    `unknown subcommand ${sub ?? '(none)'}. Use \`grade --from <counts.json>\` or \`handoff --from <envelope.json>\`.\n`,
  )
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
