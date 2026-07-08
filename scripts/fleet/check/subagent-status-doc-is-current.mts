#!/usr/bin/env node
/**
 * @file Drift gate between the subagent return-status contract in code and its
 *   documentation. `@socketsecurity/lib/ai/subagent-status` defines the
 *   `SubagentStatus` union (the source of truth an orchestrator routes on), and
 *   `docs/agents.md/fleet/agent-delegation.md` documents the same four states
 *   in a table. If the doc and the code disagree — a state renamed in code but
 *   not the doc, or a fifth state documented but never typed — an orchestrator
 *   reading the doc routes on a contract the code won't honor. "Code is law":
 *   the doc says "this table is checked against that type"; this is the check
 *   that makes the claim true. The canonical set is duplicated here (cross-repo
 *   source import from the lib is banned), so this check is the doc-side guard
 *   that keeps the prose pinned to the published vocabulary. Bump CANONICAL
 *   here in the same change that bumps the lib union and the doc table. Exit
 *   codes: 0 — the doc lists exactly the canonical statuses (or the doc /
 *   section is absent, fail-open: a repo without the delegation doc has no
 *   contract to keep in sync); 1 — the documented set diverged. Usage: node
 *   scripts/fleet/check/subagent-status-doc-is-current.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// The canonical four-state vocabulary. Origin of truth: the `SubagentStatus`
// union in `@socketsecurity/lib/ai/subagent-status`. Kept in sync by this
// check; bump all three (lib union, doc table, this list) together.
const CANONICAL_STATUSES = [
  'blocked',
  'done',
  'done-with-concerns',
  'needs-context',
] as const

const DELEGATION_DOC = path.join(
  REPO_ROOT,
  'docs',
  'agents.md',
  'fleet',
  'agent-delegation.md',
)

// The status table lives under this heading; statuses appear as `\`name\``
// table-cell code spans. We scope to the section so unrelated code spans
// elsewhere in the doc don't pollute the set.
const SECTION_HEADING = '## Subagent return contract'

// Extract the documented status set: every `\`status\`` code span inside the
// return-contract section that matches the kebab-case status shape. Returns
// undefined when the section is absent (caller fails open).
export function parseDocumentedStatuses(
  docText: string,
): ReadonlySet<string> | undefined {
  const start = docText.indexOf(SECTION_HEADING)
  if (start < 0) {
    return undefined
  }
  // Section ends at the next level-2 heading or end of file.
  const rest = docText.slice(start + SECTION_HEADING.length)
  const nextHeading = rest.indexOf('\n## ')
  const section = nextHeading < 0 ? rest : rest.slice(0, nextHeading)
  const found = new Set<string>()
  const spanRe = /`([a-z][a-z-]*)`/g
  let m: RegExpExecArray | null
  while ((m = spanRe.exec(section))) {
    const token = m[1]!
    // Only collect tokens that look like a status (kebab-case word), and only
    // those in the canonical set OR a near-miss — a stray prose code span like
    // `advance` (an escalation, not a status) is filtered by intersecting with
    // the union of canonical + any token that isn't a known escalation verb.
    if (!ESCALATION_VERBS.has(token)) {
      found.add(token)
    }
  }
  return found
}

// Escalation actions also appear as code spans in the table's right column;
// they are not statuses, so exclude them from the documented-status set.
const ESCALATION_VERBS = new Set([
  'advance',
  'escalate',
  'redispatch',
  'surface',
])

export function diffStatusSets(documented: ReadonlySet<string>): {
  readonly extra: string[]
  readonly missing: string[]
} {
  const canonical = new Set<string>(CANONICAL_STATUSES)
  const missing = [...canonical].filter(s => !documented.has(s)).toSorted()
  const extra = [...documented].filter(s => !canonical.has(s)).toSorted()
  return { extra, missing }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(DELEGATION_DOC)) {
    // No delegation doc in this repo — nothing to keep in sync.
    process.exitCode = 0
    return
  }
  const docText = readFileSync(DELEGATION_DOC, 'utf8')
  const documented = parseDocumentedStatuses(docText)
  if (!documented) {
    // Section absent — fail open.
    process.exitCode = 0
    return
  }
  const { extra, missing } = diffStatusSets(documented)
  if (!missing.length && !extra.length) {
    if (!quiet) {
      logger.log('✔ Subagent status doc matches the SubagentStatus contract.')
    }
    process.exitCode = 0
    return
  }
  const lines = [
    'subagent-status-doc-matches-code: agent-delegation.md drifted from the SubagentStatus contract.',
    `  doc: ${path.relative(REPO_ROOT, DELEGATION_DOC)} → "${SECTION_HEADING}"`,
  ]
  if (missing.length) {
    lines.push(
      `  missing from the doc table: ${joinAnd(missing)} — add a row for each.`,
    )
  }
  if (extra.length) {
    lines.push(
      `  documented but not in the code union: ${joinAnd(extra)} — remove the row, or add the state to SubagentStatus + CANONICAL_STATUSES.`,
    )
  }
  lines.push(
    '  Keep the lib union, the doc table, and CANONICAL_STATUSES in lockstep.',
  )
  logger.error(lines.join('\n'))
  process.exitCode = 1
}

main()
