#!/usr/bin/env node
/**
 * @file Ordering gate for the reviewing-code pipeline. The skill's review
 *   passes run in the order `ALL_ROLES` declares, and the spec-compliance pass
 *   MUST come before the quality passes (discovery / remediation): matching a
 *   change against its stated intent is cheaper to fix before quality review
 *   than after, and a quality pass on out-of-scope code is a wasted round-trip.
 *   The subagent-driven-development discipline this encodes is "spec compliance
 *   always precedes code quality". "Code is law": the SKILL.md says the
 *   ordering is a contract; this check makes it one by parsing `ALL_ROLES` out
 *   of `reviewing-code/run.mts` and failing when spec-compliance lands at or
 *   after any quality role. Exit codes: 0 — spec-compliance precedes every
 *   quality role (or the runner / ALL_ROLES is absent, fail-open: a repo
 *   without the skill has no order to enforce); 1 — the order regressed. Usage:
 *   node scripts/fleet/check/review-stages-are-ordered.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const RUNNER = path.join(
  REPO_ROOT,
  '.claude',
  'skills',
  'fleet',
  'reviewing-code',
  'run.mts',
)

// The gate role and the quality roles it must precede. A quality pass reviews
// HOW the code is written; spec-compliance reviews WHETHER it matches intent,
// and that verdict gates the rest.
const GATE_ROLE = 'spec-compliance'
const QUALITY_ROLES = ['discovery', 'remediation']

// Parse the ordered role list out of `const ALL_ROLES: readonly Role[] = [ … ]`.
// Returns the role strings in declared order, or undefined when the declaration
// is absent (caller fails open).
export function parseAllRoles(source: string): string[] | undefined {
  // `const ALL_ROLES` then any chars up to `=`, optional space, `[`, then
  // capture group 1 = everything up to the closing `]` (the array body).
  // oxlint-disable-next-line socket/no-source-sniffing -- this check validates the DECLARED source order of ALL_ROLES; importing the array yields runtime values without their lexical order, so parsing the source text is the intent.
  const m = /const ALL_ROLES:[^=]*=\s*\[([^\]]*)\]/.exec(source)
  if (!m) {
    return undefined
  }
  const roles: string[] = []
  // A single-quoted string `'…'` (group 1) OR a double-quoted string `"…"`
  // (group 2) — each array element is a quoted role name.
  const itemRe = /'([^']+)'|"([^"]+)"/g
  let item: RegExpExecArray | null
  while ((item = itemRe.exec(m[1]!))) {
    roles.push((item[1] ?? item[2])!)
  }
  return roles
}

// Quality roles that appear at or before the gate role — i.e. the ordering
// violations. Empty when the order is correct (or the gate role is absent,
// which is reported separately).
export function orderViolations(roles: readonly string[]): string[] {
  const gateIdx = roles.indexOf(GATE_ROLE)
  if (gateIdx < 0) {
    return []
  }
  return QUALITY_ROLES.filter(q => {
    const qIdx = roles.indexOf(q)
    return qIdx >= 0 && qIdx <= gateIdx
  })
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(RUNNER)) {
    process.exitCode = 0
    return
  }
  const source = readFileSync(RUNNER, 'utf8')
  const roles = parseAllRoles(source)
  if (!roles) {
    // No ALL_ROLES declaration — fail open.
    process.exitCode = 0
    return
  }
  if (!roles.includes(GATE_ROLE)) {
    logger.error(
      `review-stages-are-ordered: \`${GATE_ROLE}\` pass is missing from ALL_ROLES in ${path.relative(REPO_ROOT, RUNNER)}. The quality passes must be gated by a spec-compliance pass — add it as the first role.`,
    )
    process.exitCode = 1
    return
  }
  const violations = orderViolations(roles)
  if (!violations.length) {
    if (!quiet) {
      logger.log(`✔ ${GATE_ROLE} precedes the quality passes in ALL_ROLES.`)
    }
    process.exitCode = 0
    return
  }
  logger.error(
    [
      `review-stages-are-ordered: \`${GATE_ROLE}\` must run BEFORE the quality passes, but ${joinAnd(violations)} run(s) at or before it.`,
      `  file: ${path.relative(REPO_ROOT, RUNNER)} (ALL_ROLES)`,
      `  order seen: ${roles.join(' → ')}`,
      `  fix: move \`${GATE_ROLE}\` ahead of ${joinAnd(QUALITY_ROLES)} in ALL_ROLES.`,
    ].join('\n'),
  )
  process.exitCode = 1
}

main()
