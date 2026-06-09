// Fleet check — every enforcer ships thorough tests.
//
// "Code is law" only holds if the law is TESTED, and tested thoroughly: a
// codification (a hook or a `socket/*` lint rule) without tests is not done,
// and a token single-case test that only checks the bad input proves nothing
// about the good input passing through, the bypass, or the edge cases. This
// check fails `check --all` when an enforcer has no test OR a token test.
//
// What it scans:
//   - Hooks under .claude/hooks/{fleet,repo}/<name>/ that have an index.mts.
//   - Lint rules under .config/fleet/oxlint-plugin/rules/<name>.mts.
//
// ERROR when, for an enforcer:
//   - no test file exists (hook: <dir>/test/*.test.mts; rule:
//     .config/fleet/oxlint-plugin/test/<name>.test.mts), OR
//   - the test is a TOKEN test (not thorough):
//       * hook test with fewer than MIN_HOOK_CASES `test(`/`it(` cases, or
//       * lint-rule test missing a `valid:` array OR an `invalid:` array
//         (a RuleTester run must exercise BOTH arms).
//
// A few enforcers legitimately can't be unit-tested the usual way (setup/
// installer hooks that shell out to a machine, SessionStart probes). Those are
// listed in NO_TEST_ALLOWLIST with a one-line reason; everything else must
// carry thorough tests.
//
// Usage: node scripts/fleet/check/enforcers-have-thorough-tests.mts [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// A hook test must exercise at least this many cases to count as thorough:
// the fires-case + the does-not-fire case at minimum. Real guards have far
// more (each shape, bypass, pass-through, malformed); two is the floor below
// which it is provably a token test.
const MIN_HOOK_CASES = 2

// Enforcers that can't carry conventional unit tests, with the reason. Keep
// this short and justified — it is the exception, not the escape hatch.
const NO_TEST_ALLOWLIST: Record<string, string> = {
  __proto__: null as never,
  'broken-hook-detector':
    'SessionStart probe — exercised by the hooks it scans',
  // installer hooks shell out to the host machine (keychain, pipx, git config)
  'setup-security-tools':
    'installer — mutates the host machine, no pure surface',
  'setup-signing': 'installer — writes git signing config to the host',
}

export interface TestGap {
  readonly kind: 'hook' | 'rule'
  readonly name: string
  readonly reason: string
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter(n => {
      if (n === '_shared' || n.startsWith('.')) {
        return false
      }
      try {
        return statSync(path.join(dir, n)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

// Count `test('…'` / `it('…'` case registrations in a test source.
export function countTestCases(src: string): number {
  // Match every test-case registration call in source text:
  // \b           — word boundary so "iteit" doesn't match
  // (?:it|test)  — the two vitest case-registration identifiers
  // \s*          — optional whitespace before .each or (
  // (?:\.each\([^)]*\))? — optional .each(...) call with any arguments
  // \s*\(        — required opening paren that starts the case callback
  const matches = src.match(/\b(?:it|test)\s*(?:\.each\([^)]*\))?\s*\(/g)
  return matches ? matches.length : 0
}

// A RuleTester test must drive BOTH arms: a `valid` array AND an `invalid`
// array (each typically holding several cases).
export function hasBothRuleArms(src: string): boolean {
  return /\bvalid\s*:/.test(src) && /\binvalid\s*:/.test(src)
}

export function scanHooks(repoRoot: string): TestGap[] {
  const gaps: TestGap[] = []
  for (const seg of ['fleet', 'repo']) {
    const hooksDir = path.join(repoRoot, '.claude', 'hooks', seg)
    for (const name of listDirs(hooksDir)) {
      const dir = path.join(hooksDir, name)
      if (!existsSync(path.join(dir, 'index.mts'))) {
        continue
      }
      if (NO_TEST_ALLOWLIST[name]) {
        continue
      }
      const testDir = path.join(dir, 'test')
      const testFiles = existsSync(testDir)
        ? readdirSync(testDir).filter(f => f.endsWith('.test.mts'))
        : []
      if (testFiles.length === 0) {
        gaps.push({ kind: 'hook', name, reason: 'no test/*.test.mts' })
        continue
      }
      let cases = 0
      for (const f of testFiles) {
        cases += countTestCases(readFileSync(path.join(testDir, f), 'utf8'))
      }
      if (cases < MIN_HOOK_CASES) {
        gaps.push({
          kind: 'hook',
          name,
          reason: `token test — only ${cases} case(s); needs both a fires-case and a passes-case (plus bypass/pass-through/edge)`,
        })
      }
    }
  }
  return gaps
}

export function scanRules(repoRoot: string): TestGap[] {
  const rulesDir = path.join(repoRoot, '.config/fleet/oxlint-plugin/rules')
  const testDir = path.join(repoRoot, '.config/fleet/oxlint-plugin/test')
  const gaps: TestGap[] = []
  let rules: string[]
  try {
    rules = readdirSync(rulesDir).filter(
      f => f.endsWith('.mts') && !f.endsWith('.test.mts'),
    )
  } catch {
    return gaps
  }
  for (let i = 0, { length } = rules; i < length; i += 1) {
    const f = rules[i]!
    const name = f.slice(0, -'.mts'.length)
    if (NO_TEST_ALLOWLIST[name]) {
      continue
    }
    const testPath = path.join(testDir, `${name}.test.mts`)
    if (!existsSync(testPath)) {
      gaps.push({ kind: 'rule', name, reason: `no test/${name}.test.mts` })
      continue
    }
    const src = readFileSync(testPath, 'utf8')
    if (!hasBothRuleArms(src)) {
      gaps.push({
        kind: 'rule',
        name,
        reason:
          'token test — missing a valid[] or invalid[] arm (RuleTester must drive both)',
      })
    }
  }
  return gaps
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const gaps = [...scanHooks(REPO_ROOT), ...scanRules(REPO_ROOT)]
  if (gaps.length) {
    logger.fail(
      '[check-enforcers-have-thorough-tests] enforcers missing thorough tests:',
    )
    for (let i = 0, { length } = gaps; i < length; i += 1) {
      const g = gaps[i]!
      logger.error(`  ✗ ${g.kind} ${g.name} — ${g.reason}`)
    }
    logger.error(
      '  Code is law: a hook or socket/* rule ships thorough tests (both arms, every branch, bypass, pass-through, edge) in the same change.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-enforcers-have-thorough-tests] every hook + lint rule carries tests.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
