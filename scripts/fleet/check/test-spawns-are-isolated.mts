#!/usr/bin/env node
/*
 * @file Fleet-wide sweep: a test that spawns a process must point that child
 *   at an isolation sandbox before it runs, and must not undo the pointing
 *   afterwards. The three clauses, why they exist, and what the detectors can
 *   and cannot see all live in `scripts/fleet/_shared/test-isolation-law.mts`;
 *   this file is the repo-wide runner over that law, plus a narrow fixer.
 *   See docs/agents.md/fleet/test-layout.md ("Isolation").
 *
 *   REPORT-ONLY (exit 0). Flip ENFORCING once a repo's test tree is clean —
 *   the sweep over the socket-patch CLI tests it was built from still returns
 *   24 real unisolated spawns, so a gate today would fail every native member
 *   on day one. Clause 2 is already enforced at edit time by the
 *   `test-env-scrub-order-guard` hook, which is the half with zero measured
 *   false positives.
 *
 *   `--fix` applies the ONE rewrite that is mechanical: hoisting a
 *   standalone scrub-helper call above the first environment write in the
 *   same function. It refuses when the first write sits mid-chain
 *   (`cmd.arg(x).args(y).env("K", v)`), because moving a statement in front
 *   of a chain fragment is a restructure, not a move — the original incident
 *   was exactly that case and a human split the chain. Everything else is
 *   reported and left alone.
 *
 *   Exit codes:
 *   - 0 — no findings, or findings while ENFORCING is off
 *   - 1 — findings AND ENFORCING is on
 *
 *   Usage: node scripts/fleet/check/test-spawns-are-isolated.mts [--fix] [--quiet]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { envSetKey, sourceFunctions } from '../_shared/spawn-env-scan.mts'
import { testIsolationSmells } from '../_shared/test-isolation-law.mts'

import type { TestIsolationSmell } from '../_shared/test-isolation-law.mts'

const logger = getDefaultLogger()

// Report-only until a native member's test tree is clean. Clause 1 alone
// returns 24 findings over the 142-file suite this law came from, every one a
// real unisolated spawn — a gate now would be a wall, not a signal.
const ENFORCING = false

/**
 * Where tests live, across every fleet language. A Rust integration test is a
 * bare `tests/*.rs` with no naming convention, so the directory is the signal.
 */
export const TEST_GLOBS: readonly string[] = Object.freeze([
  '**/__tests__/**/*.{cjs,cts,js,mjs,mts,ts}',
  '**/*.{spec,test}.{cjs,cts,js,jsx,mjs,mts,ts,tsx}',
  '**/tests/**/*.rs',
  'test/**/*.{cjs,cts,js,mjs,mts,ts}',
])

// Trees that hold code nobody here owns, build output, or — `fixtures/` —
// input that is deliberately broken so a detector has something to catch.
const IGNORED = Object.freeze([
  '**/.cache/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/fixtures/**',
  '**/node_modules/**',
  '**/target/**',
  '**/upstream/**',
  '**/vendor/**',
])

/**
 * Every finding in one repo, file by file.
 */
export interface TestIsolationReport {
  file: string
  smells: readonly TestIsolationSmell[]
}

// A whole statement that is one call and nothing else: optional leading
// whitespace, a possibly-qualified callee (`scrub_socket_env`,
// `cache_env::scrub`, `env.reset`), its argument list, an optional
// semicolon. Anything with an assignment, an operator, or a trailing method
// is not a bare call and is left alone.
const BARE_CALL_STATEMENT_RE =
  /^\s*[\w$]+(?:(?:::|\.)[\w$]+)*\([^()]*\)\s*;?\s*$/
// An environment write that OPENS its statement: a receiver, then `.env(`.
// A continuation line (` .env("K", v)` inside a chain) has no receiver before
// the dot and deliberately does not match.
const STATEMENT_ENV_SET_RE = /^\s*[\w$]+(?:(?:::|\.)[\w$]+)*\.envs?\(/

/**
 * Rewrite `source` so the scrub call on `smell.line` runs BEFORE the first
 * environment write of its function, or `undefined` when the shape is not the
 * mechanical one. Pure — the caller decides whether to write it back.
 */
export function hoistScrubCall(
  source: string,
  smell: TestIsolationSmell,
): string | undefined {
  if (smell.rule !== 'scrub-before-override') {
    return undefined
  }
  const lines = source.split('\n')
  const scrubIndex = smell.line - 1
  const scrubLine = lines[scrubIndex]
  // The finding must sit on a call statement of its own. A finding on an
  // `.env_remove("K")` inside a chain names no helper to move.
  if (scrubLine === undefined || !BARE_CALL_STATEMENT_RE.test(scrubLine)) {
    return undefined
  }
  const fn = sourceFunctions(source).find(
    candidate =>
      smell.line >= candidate.firstLine &&
      smell.line < candidate.firstLine + candidate.bodyLines.length,
  )
  if (!fn) {
    return undefined
  }
  let firstSetIndex = -1
  for (let i = 0, { length } = fn.bodyLines; i < length; i += 1) {
    if (envSetKey(fn.bodyLines[i]!) !== undefined) {
      firstSetIndex = fn.firstLine - 1 + i
      break
    }
  }
  if (firstSetIndex === -1 || firstSetIndex >= scrubIndex) {
    return undefined
  }
  // Mid-chain: the write is a continuation of an earlier statement, so there
  // is no line boundary in front of it to move the scrub to.
  if (!STATEMENT_ENV_SET_RE.test(lines[firstSetIndex]!)) {
    return undefined
  }
  const moved = [...lines]
  moved.splice(scrubIndex, 1)
  moved.splice(firstSetIndex, 0, scrubLine)
  return moved.join('\n')
}

/**
 * Scan a repo's test tree. Returns one entry per file that smelled, sorted by
 * path; a repo with no tests returns [].
 */
export function scanTestTree(repoRoot: string): TestIsolationReport[] {
  const files = globSync([...TEST_GLOBS], {
    absolute: false,
    cwd: repoRoot,
    ignore: [...IGNORED],
  })
  const reports: TestIsolationReport[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    const smells = testIsolationSmells(
      readFileSync(path.join(repoRoot, rel), 'utf8'),
    )
    if (smells.length > 0) {
      reports.push({ file: rel, smells })
    }
  }
  return reports.toSorted((a, b) => a.file.localeCompare(b.file))
}

/**
 * Apply every mechanical hoist in one file. Returns the number applied; 0
 * means nothing in the file was unambiguous.
 */
export function applyHoists(
  repoRoot: string,
  report: TestIsolationReport,
): number {
  const abs = path.join(repoRoot, report.file)
  let source = readFileSync(abs, 'utf8')
  let applied = 0
  // One at a time, re-reading the findings after each rewrite: a hoist shifts
  // every later line number in the file.
  for (;;) {
    const smells = testIsolationSmells(source).filter(
      smell => smell.rule === 'scrub-before-override',
    )
    let next: string | undefined
    for (let i = 0, { length } = smells; i < length; i += 1) {
      next = hoistScrubCall(source, smells[i]!)
      if (next !== undefined) {
        break
      }
    }
    if (next === undefined || next === source) {
      break
    }
    source = next
    applied += 1
  }
  if (applied > 0) {
    writeFileSync(abs, source)
  }
  return applied
}

function main(): void {
  const fix = process.argv.includes('--fix')
  const quiet = process.argv.includes('--quiet')
  const reports = scanTestTree(REPO_ROOT)
  if (reports.length === 0) {
    if (!quiet) {
      logger.success(
        'test-spawns-are-isolated: every spawning test isolates its children.',
      )
    }
    return
  }
  let fixed = 0
  if (fix) {
    for (let i = 0, { length } = reports; i < length; i += 1) {
      fixed += applyHoists(REPO_ROOT, reports[i]!)
    }
  }
  const remaining = fix ? scanTestTree(REPO_ROOT) : reports
  const total = remaining.reduce((sum, r) => sum + r.smells.length, 0)
  if (fixed > 0) {
    logger.success(
      `test-spawns-are-isolated: hoisted ${fixed} scrub call(s) above the environment they were wiping.`,
    )
  }
  if (total === 0) {
    return
  }
  const label = ENFORCING ? logger.fail : logger.warn
  label.call(
    logger,
    `test-spawns-are-isolated: ${total} finding(s) across ${remaining.length} test file(s):`,
  )
  for (let i = 0, { length } = remaining; i < length; i += 1) {
    const report = remaining[i]!
    logger.error(`  ${report.file}`)
    for (let j = 0, count = report.smells.length; j < count; j += 1) {
      const smell = report.smells[j]!
      logger.error(`    ${smell.line} [${smell.rule}] ${smell.detail}`)
    }
  }
  logger.error(
    '  Point every spawned child at an isolation sandbox — probes included — ' +
      'scrub the ambient environment before setting overrides, and carry the ' +
      'version-manager roots across a HOME redirect.',
  )
  logger.error(
    '  Re-run with --fix to hoist any scrub call whose move is mechanical; ' +
      'the rest need a human. See docs/agents.md/fleet/test-layout.md.',
  )
  if (ENFORCING) {
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
