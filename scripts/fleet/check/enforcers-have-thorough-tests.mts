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
//   - Lint rules under .config/fleet/oxlint-plugin/fleet/<name>/index.mts.
//   - Check scripts under scripts/{fleet,repo}/check/<name>.mts, tested by
//     test/unit/fleet/check-<name>.test.mts (or the bare <name>.test.mts).
//
// Hook + lint-rule tests are NOT co-located in the cascaded trees; they live
// under test/repo/{unit,integration}/{hooks,lint-rules}/<name>.test.mts (vitest)
// and are WHEELHOUSE-ONLY (never cascaded — a member ships the sources but not
// their tests). So this check asserts test presence only in the wheelhouse
// (OWNS_RELOCATED_TESTS); a member returns no gaps. See
// docs/agents.md/fleet/test-layout.md.
//
// ERROR when, for an enforcer (wheelhouse only):
//   - no test file exists (hook: test/repo/.../hooks/<name>.test.mts; rule:
//     test/repo/.../lint-rules/<name>.test.mts), OR
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

import {
  HOOK_TEST_DIRS,
  LINT_RULE_TEST_DIRS,
  OWNS_RELOCATED_TESTS,
  REPO_ROOT,
} from '../paths.mts'

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

// Check scripts that can't carry a conventional unit test yet, with the reason.
// The fleet entries run main() at module scope (no entrypoint guard) and export
// no pure surface, so importing them has side effects (spawns git/gh, sets
// exitCode) — each needs a guard + an exported detection fn before it's testable
// (two are thin wrappers over already-tested shared libs). The repo entries are
// wheelhouse-only checks whose tests are still pending. Shrink as each is fixed.
const CHECK_SCRIPT_TEST_ALLOWLIST: Record<string, string> = {
  __proto__: null as never,
  'bundle-is-installable':
    'no entrypoint guard + no injectable validator seam — needs refactor',
  'capability-hooks-are-registered':
    'wheelhouse-only repo check — test pending',
  'coverage-badge-is-current':
    'thin wrapper — logic tested in test/unit/fleet/coverage-badge.test.mts',
  'fleet-members-are-onboarded': 'wheelhouse-only repo check — test pending',
  'llms-txt-is-current':
    'thin wrapper — logic tested in test/unit/fleet/make-llms-txt.test.mts',
  'sparkle-auto-update-is-disabled':
    'thin wrapper — logic tested in test/unit/fleet/sparkle-auto-update.test.mts',
  'template-fleet-oxlint-ignore-current':
    'wheelhouse-only repo check — test pending',
}

export interface TestGap {
  readonly kind: 'check' | 'hook' | 'rule'
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

// The relocated hook test for <name>, if present in any HOOK_TEST_DIRS home.
// Resolved RELATIVE to the scanned repoRoot (each HOOK_TEST_DIRS entry's suffix
// under REPO_ROOT, re-rooted at repoRoot) so a temp-dir fixture resolves to its
// own test/repo/ tree, not the live wheelhouse's.
function findHookTest(repoRoot: string, name: string): string | undefined {
  for (let i = 0, { length } = HOOK_TEST_DIRS; i < length; i += 1) {
    const rel = path.relative(REPO_ROOT, HOOK_TEST_DIRS[i]!)
    const candidate = path.join(repoRoot, rel, `${name}.test.mts`)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

export function scanHooks(repoRoot: string): TestGap[] {
  // Hook tests are wheelhouse-only (relocated under test/repo/, never cascaded).
  // A member ships the hook sources but not their tests, so it has no gaps.
  if (!OWNS_RELOCATED_TESTS) {
    return []
  }
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
      const testPath = findHookTest(repoRoot, name)
      if (!testPath) {
        gaps.push({
          kind: 'hook',
          name,
          reason: `no test under test/repo/.../hooks/${name}.test.mts`,
        })
        continue
      }
      const cases = countTestCases(readFileSync(testPath, 'utf8'))
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

// The relocated lint-rule test for <id>, if present in any LINT_RULE_TEST_DIRS
// home. Lint-rule tests live under test/repo/ (wheelhouse-only), never
// co-located in the cascaded fleet/<id>/test/ tree.
function findRuleTest(repoRoot: string, id: string): string | undefined {
  for (let i = 0, { length } = LINT_RULE_TEST_DIRS; i < length; i += 1) {
    const rel = path.relative(REPO_ROOT, LINT_RULE_TEST_DIRS[i]!)
    const candidate = path.join(repoRoot, rel, `${id}.test.mts`)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

export function scanRules(repoRoot: string): TestGap[] {
  // Lint-rule tests are wheelhouse-only (relocated under test/repo/, never
  // cascaded). A member ships the rule sources but not their tests, so it has
  // no gaps.
  if (!OWNS_RELOCATED_TESTS) {
    return []
  }
  // Each rule is a dir under the cascaded fleet/ tier:
  // .config/fleet/oxlint-plugin/fleet/<id>/index.mts. Its test lives under
  // test/repo/.../lint-rules/<id>.test.mts.
  const fleetDir = path.join(repoRoot, '.config/fleet/oxlint-plugin/fleet')
  const gaps: TestGap[] = []
  let rules: string[]
  try {
    rules = readdirSync(fleetDir, { withFileTypes: true })
      .filter(
        d =>
          d.isDirectory() &&
          !d.name.startsWith('_') &&
          existsSync(path.join(fleetDir, d.name, 'index.mts')),
      )
      .map(d => d.name)
  } catch {
    return gaps
  }
  for (let i = 0, { length } = rules; i < length; i += 1) {
    const name = rules[i]!
    if (NO_TEST_ALLOWLIST[name]) {
      continue
    }
    const testPath = findRuleTest(repoRoot, name)
    if (!testPath) {
      gaps.push({
        kind: 'rule',
        name,
        reason: `no test under test/repo/.../lint-rules/${name}.test.mts`,
      })
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

// The check-script test for <name>, accepting either the canonical
// `check-<name>.test.mts` or the bare `<name>.test.mts` (a few predate the
// `check-` prefix). Check tests live under test/unit/fleet/ (wheelhouse-only —
// cascade-excluded from members, like hook/rule tests).
function findCheckTest(repoRoot: string, name: string): string | undefined {
  const dir = path.join(repoRoot, 'test', 'unit', 'fleet')
  for (const base of [`check-${name}.test.mts`, `${name}.test.mts`]) {
    const candidate = path.join(dir, base)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

export function scanCheckScripts(repoRoot: string): TestGap[] {
  // Check-script tests are wheelhouse-only (under test/unit/fleet/, cascade-
  // excluded). A member ships the check sources but not their tests.
  if (!OWNS_RELOCATED_TESTS) {
    return []
  }
  const gaps: TestGap[] = []
  for (const seg of ['fleet', 'repo']) {
    const checkDir = path.join(repoRoot, 'scripts', seg, 'check')
    let files: string[]
    try {
      files = readdirSync(checkDir).filter(n => n.endsWith('.mts'))
    } catch {
      continue
    }
    for (let i = 0, { length } = files; i < length; i += 1) {
      const name = files[i]!.slice(0, -'.mts'.length)
      if (CHECK_SCRIPT_TEST_ALLOWLIST[name]) {
        continue
      }
      const testPath = findCheckTest(repoRoot, name)
      if (!testPath) {
        gaps.push({
          kind: 'check',
          name,
          reason: `no test under test/unit/fleet/check-${name}.test.mts`,
        })
        continue
      }
      const cases = countTestCases(readFileSync(testPath, 'utf8'))
      if (cases < MIN_HOOK_CASES) {
        gaps.push({
          kind: 'check',
          name,
          reason: `token test — only ${cases} case(s); needs a fires-case + a passes-case`,
        })
      }
    }
  }
  return gaps
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const gaps = [
    ...scanHooks(REPO_ROOT),
    ...scanRules(REPO_ROOT),
    ...scanCheckScripts(REPO_ROOT),
  ]
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
      '[check-enforcers-have-thorough-tests] every hook + lint rule + check script carries tests.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
