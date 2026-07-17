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
//     test/repo/unit/check-<name>.test.mts (or the bare <name>.test.mts).
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
// Usage: node scripts/fleet/check/enforcers-have-thorough-tests.mts [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  HOOK_TEST_DIRS,
  LINT_RULE_TEST_DIRS,
  OWNS_RELOCATED_TESTS,
  REPO_ROOT,
  TEST_REPO_DIR,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// A hook test must exercise at least this many cases to count as thorough:
// the fires-case + the does-not-fire case at minimum. Real guards have far
// more (each shape, bypass, pass-through, malformed); two is the floor below
// which it is provably a token test.
const MIN_HOOK_CASES = 2

function findCheckTest(repoRoot: string, name: string): string | undefined {
  const rel = path.relative(REPO_ROOT, TEST_REPO_DIR)
  const basenames = new Set<string>()
  basenames.add(`check-${name}.test.mts`)
  basenames.add(`${name}.test.mts`)
  return findTestByBasenames(path.join(repoRoot, rel), basenames)
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

// The relocated lint-rule tests for <id> in every recognized home. A rule may
// have pure in-process unit coverage and a separate subprocess RuleTester
// integration smoke; either file may own the case table without duplicating it.
function findRuleTests(repoRoot: string, id: string): string[] {
  const found: string[] = []
  for (let i = 0, { length } = LINT_RULE_TEST_DIRS; i < length; i += 1) {
    const rel = path.relative(REPO_ROOT, LINT_RULE_TEST_DIRS[i]!)
    const candidate = path.join(repoRoot, rel, `${id}.test.mts`)
    if (existsSync(candidate)) {
      found.push(candidate)
    }
  }
  return found
}

// The check-script test for <name>, accepting either the canonical
// `check-<name>.test.mts` or the bare `<name>.test.mts` (a few predate the
// `check-` prefix). Both tiers' check tests live flat under test/repo/unit/
// (the test-tree migration retired the per-tier test/unit/{fleet,repo} split),
// with test/repo/integration/ as the fallback home for spawn-heavy suites.
// Wheelhouse-only dirs (cascade-excluded from members, like hook/rule tests).
function findTestByBasenames(
  dir: string,
  basenames: ReadonlySet<string>,
): string | undefined {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const candidate = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = findTestByBasenames(candidate, basenames)
      if (nested) {
        return nested
      }
    } else if (basenames.has(entry.name)) {
      return candidate
    }
  }
  return undefined
}

function hasNonEmptyRuleArm(source: string, arm: 'invalid' | 'valid'): boolean {
  const property = new RegExp(`^\\s*${arm}\\s*:\\s*\\[`, 'gm')
  for (const match of source.matchAll(property)) {
    const open = match.index + match[0].lastIndexOf('[')
    const firstCase = skipTrivia(source, open + 1)
    if (source[firstCase] !== ']') {
      return true
    }
  }
  return false
}

export interface TestGap {
  readonly kind: 'check' | 'hook' | 'rule'
  readonly name: string
  readonly reason: string
}

// Fixture tests force ownership so the scanners run outside the wheelhouse
// (a member's live run keeps the OWNS_RELOCATED_TESTS default).
export interface ScanOptions {
  readonly ownsRelocatedTests?: boolean | undefined
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

function skipTrivia(source: string, start: number): number {
  let cursor = start
  while (cursor < source.length) {
    if (/\s/.test(source[cursor]!)) {
      cursor += 1
      continue
    }
    if (source.startsWith('//', cursor)) {
      const newline = source.indexOf('\n', cursor + 2)
      return newline === -1 ? source.length : skipTrivia(source, newline + 1)
    }
    if (source.startsWith('/*', cursor)) {
      const close = source.indexOf('*/', cursor + 2)
      return close === -1 ? source.length : skipTrivia(source, close + 2)
    }
    break
  }
  return cursor
}

// Count `test('…'` / `it('…'` case registrations in a test source.
export function countTestCases(src: string): number {
  // Match every test-case registration call in source text:
  // \b           — word boundary so "iteit" doesn't match
  // (?:it|test)  — the two vitest case-registration identifiers
  // \s*          — optional whitespace before .each or (
  // (?:\.each\([^)]*\))? — optional .each(...) call with any arguments
  // \s*\(        — required opening paren that starts the case callback
  const matches = src.match(/^\s*(?:it|test)\s*(?:\.each\([^)]*\))?\s*\(/gm)
  return matches ? matches.length : 0
}

// A RuleTester test must drive BOTH arms with at least one real case. Comments,
// strings, and empty arrays do not count as executable coverage.
export function hasBothRuleArms(src: string): boolean {
  return hasNonEmptyRuleArm(src, 'valid') && hasNonEmptyRuleArm(src, 'invalid')
}

export function scanCheckScripts(
  repoRoot: string,
  options?: ScanOptions | undefined,
): TestGap[] {
  const opts = { __proto__: null, ...options }
  // Check-script tests are wheelhouse-only (under test/repo/unit/, cascade-
  // excluded). A member ships the check sources but not their tests.
  if (!(opts.ownsRelocatedTests ?? OWNS_RELOCATED_TESTS)) {
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
      const testPath = findCheckTest(repoRoot, name)
      if (!testPath) {
        gaps.push({
          kind: 'check',
          name,
          reason: `no test under test/repo/{unit,integration}/check-${name}.test.mts`,
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

export function scanHooks(
  repoRoot: string,
  options?: ScanOptions | undefined,
): TestGap[] {
  const opts = { __proto__: null, ...options }
  // Hook tests are wheelhouse-only (relocated under test/repo/, never cascaded).
  // A member ships the hook sources but not their tests, so it has no gaps.
  if (!(opts.ownsRelocatedTests ?? OWNS_RELOCATED_TESTS)) {
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

export function scanRules(
  repoRoot: string,
  options?: ScanOptions | undefined,
): TestGap[] {
  const opts = { __proto__: null, ...options }
  // Lint-rule tests are wheelhouse-only (relocated under test/repo/, never
  // cascaded). A member ships the rule sources but not their tests, so it has
  // no gaps.
  if (!(opts.ownsRelocatedTests ?? OWNS_RELOCATED_TESTS)) {
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
    const testPaths = findRuleTests(repoRoot, name)
    if (testPaths.length === 0) {
      gaps.push({
        kind: 'rule',
        name,
        reason: `no test under test/repo/.../lint-rules/${name}.test.mts`,
      })
      continue
    }
    if (
      !testPaths.some(testPath =>
        hasBothRuleArms(readFileSync(testPath, 'utf8')),
      )
    ) {
      gaps.push({
        kind: 'rule',
        name,
        reason:
          'token test — missing a non-empty valid[] or invalid[] arm (RuleTester must drive both)',
      })
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

if (isMainModule(import.meta.url)) {
  main()
}
