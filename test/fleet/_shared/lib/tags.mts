/**
 * @file Fleet-canonical test-title prefix helpers. Pure string functions so any
 *   test runner can adopt them without a wrapper style. Tags surface in
 *   reporter output and let CI dashboards group tests by platform or by
 *   tolerance budget — `[flaky]` aggregates retry-prone tests, `[windows]` /
 *   `[unix]` mark platform-gated tests. Pairs with `./platform.mts`
 *   (predicates) and `./timing.mts` (budgets). The runner-specific wrappers
 *   (`itWindowsOnly`, `describeFlaky`, etc.) live in the per-repo
 *   `test/util/skip-helpers.mts` and call into this module.
 */

/**
 * Prefix a test title with `[flaky]` so reporters can group tests carrying a
 * platform-tolerance budget (typically Windows timing).
 */
export function taggedFlaky(name: string): string {
  return `[flaky] ${name}`
}

/**
 * Prefix a test title with `[windows]` — the test is meaningful only on Windows
 * and is skipped elsewhere.
 */
export function taggedWindows(name: string): string {
  return `[windows] ${name}`
}

/**
 * Prefix a test title with `[unix]` — Linux/macOS/BSD; skipped on Windows.
 */
export function taggedUnix(name: string): string {
  return `[unix] ${name}`
}
