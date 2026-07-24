// Fleet check — every check script's name reads as an ASSERTION.
//
// The fleet convention (lint rule / skill / guard / reminder / check naming):
// a check's basename should STATE THE INVARIANT IT ASSERTS IS TRUE, so the file
// list reads as a spec — `paths-are-canonical`, `lock-step-refs-resolve`,
// `soak-excludes-have-dates` — not as a topic (`paths`, `lock-step-refs`,
// `soak-exclude-dates`). A reader scanning `scripts/fleet/check/` then sees
// WHAT each gate guarantees, not merely what area it touches.
//
// This gate fails `check --all` when a check basename is NOT in assertion form.
// Assertion form = the name ends in one of a small set of predicate tails (a
// verb phrase or "are/is/have <state>"), OR the name is in the explicit
// ALLOWLIST of already-blessed names whose shape predates / sidesteps the tails
// (e.g. `oxlint-plugin-loads`, `fleet-soak-exclude-parity`).
//
// Scope: `scripts/fleet/check/*.mts` plus `scripts/repo/check/*.mts` when the
// repo carries one (the wheelhouse's repo-tier gates). Excludes `check.mts`
// (the runner), this file's own name is allowlisted, and helper
// subdirectories (`check/paths/`) are not scanned.
//
// Why an allowlist AND a pattern: the pattern catches the common shapes
// deterministically; the allowlist covers the handful of legitimate names that
// read as assertions without matching a tail (`-loads`, `-parity`), so the
// gate is exact and self-consistent rather than fuzzy.
//
// Usage: node scripts/fleet/check/check-names-are-assertions.mts [--quiet]

import { readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Predicate tails that read as an assertion. A basename in assertion form ends
// with one of these (after its subject), e.g. `paths-are-canonical`,
// `lock-step-refs-resolve`, `soak-excludes-have-dates`.
//   -are-<state>   dirs-ARE-segmented, paths-ARE-canonical, …-ARE-absent
//   -is-<state>    setup-IS-prompt-less, provenance-IS-attested
//   -has-<state>   fleet-HAS-no-wheelhouse-only-refs (singular subject)
//   -have-<state>  enforcers-HAVE-thorough-tests, soak-excludes-HAVE-dates
//   -resolve(s)    citations-RESOLVE, script-paths-RESOLVE
//   -loads         oxlint-plugin-LOADS
//   -parity        fleet-soak-exclude-PARITY
//   -match(es)[-<object>]  headers-MATCH, tails-MATCH-naming-domain
//   -cover(s)[-<object>]   matchers-COVER-hook-tools
// Three alternatives anchored at end-of-string ($):
//   alt 1: hyphen + non-capturing group (are|have|is) + hyphen + [a-z] (state initial)
//          + [a-z0-9-]* (rest of state word) + $ — matches -are-canonical, -is-absent, …
//   alt 2: hyphen + non-capturing group of fixed bare verb tails + $ — matches -resolve, -loads, …
//   alt 3: hyphen + non-capturing group (match|matches|cover|covers), with an OPTIONAL
//          trailing object phrase (same shape as alt 1's state word) — these verbs take
//          a direct object, so subject-verb-object ("tails MATCH naming domain") is as
//          valid as bare subject-verb ("headers MATCH").
const ASSERTION_TAIL =
  // alt1: -(?:are|has|have|is)-[a-z][a-z0-9-]*$
  // alt2: -(?:resolve|resolves|loads|parity)$
  // alt3: -(?:match|matches|cover|covers)(?:-[a-z][a-z0-9-]*)?$
  /-(?:are|has|have|is)-[a-z][a-z0-9-]*$|-(?:resolve|resolves|loads|parity)$|-(?:match|matches|cover|covers)(?:-[a-z][a-z0-9-]*)?$/

// Names that read as assertions but are exempt from the tail pattern (their
// shape is blessed). Keep this short + justified — it is the exact set, not an
// escape hatch.
const ALLOWLIST = new Set<string>([
  // Self: this gate's own name reads as an assertion ("names ARE assertions")
  // but `assertions` is a noun tail, not in the verb set.
  'check-names-are-assertions',
  // Verb-assertion: "convention guards CONSULT the fleet-context detector" — a
  // declarative statement, just verb-tailed (consult) rather than -are-/-resolve.
  'convention-guards-consult-fleet-context',
  // Verb-assertion: "lint configs PROTECT verbatim paths" — declarative,
  // verb-tailed (protect).
  'lint-configs-protect-verbatim',
  // Verb-assertion: "member CI FIRES on push" — declarative, verb-tailed
  // (fires) with an object phrase, not an -are-/-is- state tail.
  'member-ci-fires-on-push',
  // Verb-assertion: "prebakes INSTALL from lock" — declarative, verb-tailed
  // (install) with a prepositional phrase.
  'prebakes-install-from-lock',
])

export function isAssertionName(basename: string): boolean {
  if (ALLOWLIST.has(basename)) {
    return true
  }
  return ASSERTION_TAIL.test(basename)
}

export interface NameViolation {
  readonly name: string
  readonly suggestion: string
}

export function scanCheckNames(repoRoot: string): NameViolation[] {
  const dirs = [
    path.join(repoRoot, 'scripts', 'fleet', 'check'),
    path.join(repoRoot, 'scripts', 'repo', 'check'),
  ]
  const violations: NameViolation[] = []
  for (let d = 0, { length: dlen } = dirs; d < dlen; d += 1) {
    let entries: string[]
    try {
      entries = readdirSync(dirs[d]!, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.mts'))
        .map(e => e.name)
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const file = entries[i]!
      const base = file.slice(0, -'.mts'.length)
      if (base === 'check') {
        // the runner, not a check
        continue
      }
      if (!isAssertionName(base)) {
        violations.push({
          name: file,
          suggestion: `rename so the basename asserts the invariant (e.g. <subject>-are-<state> / -resolve / -match[-<object>] / -cover[-<object>] / -have-<state>); "${base}" reads as a topic, not an assertion`,
        })
      }
    }
  }
  return violations
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const violations = scanCheckNames(REPO_ROOT)
  if (violations.length) {
    logger.fail(
      '[check-names-are-assertions] check scripts whose name is not an assertion:',
    )
    for (let i = 0, { length } = violations; i < length; i += 1) {
      const v = violations[i]!
      logger.error(`  ✗ ${v.name} — ${v.suggestion}`)
    }
    logger.error(
      '  A check basename should state what it asserts is true, so the check/ dir reads as a spec. Rename it (and its check.mts wiring, log prefix, test, oxlintrc entry).',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-names-are-assertions] every check basename reads as an assertion.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
