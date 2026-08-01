/**
 * @file Pure decision logic for scripts/fleet/test.mts's post-run summary: a
 *   vitest exit code of 0 means "no failures", which is also true when every
 *   matched test was skipped, or when nothing matched at all. Both are silent
 *   greens that prove nothing — the defect this module exists to close (a
 *   real incident: `pnpm test <file>` reported "All tests passed" over a
 *   suite that was 100% skipped locally, nearly waving through a runtime
 *   change to a published package). Takes the counts read back from
 *   run-vitest.mts and decides which of three outcomes applies, plus the
 *   notice text for the two non-pass ones. No I/O, no vitest import — the
 *   fast in-process seam this file's own tests exercise directly.
 */

export interface TestSummaryCounts {
  readonly failed: number
  readonly passed: number
  readonly total: number
}

export type TestOutcome = 'allSkipped' | 'noTestsMatched' | 'pass'

// `total === 0` and `passed === 0` are also true for `noTestsMatched` (a
// vacuous 0/0/0), so the empty-scope check runs first: it is the more
// specific, more actionable diagnosis (bad path/filter vs. a suite that
// skip-gated itself).
export function decideTestOutcome(counts: TestSummaryCounts): TestOutcome {
  if (counts.total === 0) {
    return 'noTestsMatched'
  }
  if (counts.passed === 0) {
    return 'allSkipped'
  }
  return 'pass'
}

// Mirrors lint.mts's `zeroScopeNotice` voice: short, states the verdict, and
// names the fix. `rerunHint` is the literal argv the operator ran (e.g.
// `test/npm/is-async-function.test.mts`), so the fix line is copy-pasteable.
export function allSkippedNotice(
  counts: TestSummaryCounts,
  rerunHint: string,
): string {
  return (
    `${counts.total} test(s) matched, 0 executed — this is NOT a pass. Every matched test was skipped.\n` +
    `Check the suite for a skip gate (e.g. FORCE_TEST=1) before trusting this run — rerun: ${rerunHint}`
  )
}

// A distinct diagnosis from `allSkippedNotice`: nothing matched at all is a
// bad path or filter, not a suite that skipped itself.
export function noTestsMatchedNotice(label: string): string {
  return (
    `0 test files matched — this is NOT a pass. Scope ${label} resolved to no test files.\n` +
    'For the whole-tree verdict: pnpm test --all'
  )
}
