/*
 * @file Runs vitest via its documented Node API (`parseCLI` + `startVitest`
 *   from `vitest/node`) instead of spawning the `vitest` binary, so
 *   scripts/fleet/test.mts can read back the finished run's test counts.
 *   Two more direct options don't fit:
 *
 *   - The built-in `json` reporter's `--outputFile` writes exactly the counts
 *     needed, but its `writeReport()` unconditionally logs "JSON report written
 *     to <path>" to stdout — a UX regression test.mts cannot accept (it spawns
 *     with `stdio: 'inherit'`, so that line lands in the real terminal on every
 *     run).
 *   - Any `--reporter` CLI flag at all — including a silent custom one — replaces
 *     vitest's OWN automatic reporter selection (`agent` reporter for
 *     AI-coding-agent-driven runs vs. `default` for a human terminal, plus the
 *     `github-actions` annotations reporter in CI): resolveConfig only applies
 *     that automatic selection when NO `--reporter` was passed. Verified live
 *     in this repo: forcing `--reporter=default` under `CLAUDECODE=1` produces
 *     a visibly different (more verbose) reporter than the auto-selected one.
 *     This script is spawned as its OWN process (never imported) so test.mts
 *     itself stays synchronous, and it passes NO `--reporter` — the exact argv
 *     test.mts already builds for the vitest binary reaches `parseCLI`
 *     untouched, so the automatic selection above is preserved byte-for-byte.
 *     Counts come from the public `Vitest.state.getTestModules()` API after the
 *     run finishes, the same documented TestModule/TestCase surface a custom
 *     reporter's `onTestRunEnd` hook would see.
 */
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { parseCLI, startVitest } from 'vitest/node'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

/**
 * The counted shape of a finished run. `total` counts every case, so
 * `total - passed - failed` is the skipped/pending remainder rather than an
 * error — folding those into `failed` would report a red run for a suite that
 * merely skipped.
 */
export interface TestTally {
  failed: number
  passed: number
  total: number
}

// Structural stand-ins for vitest's TestModule / TestCase, so the tally can be
// counted without booting vitest.
export interface TestCaseLike {
  result: () => { state: string }
}
export interface TestModuleLike {
  children: { allTests: () => Iterable<TestCaseLike> }
}

/**
 * Tally a finished run's cases. Pure over the module list — the only decision
 * logic in this script, with the vitest boot either side of it.
 */
export function tallyTestModules(
  testModules: readonly TestModuleLike[],
): TestTally {
  let total = 0
  let passed = 0
  let failed = 0
  for (let i = 0, { length } = testModules; i < length; i += 1) {
    const testModule = testModules[i]!
    for (const testCase of testModule.children.allTests()) {
      total += 1
      const { state } = testCase.result()
      if (state === 'passed') {
        passed += 1
      } else if (state === 'failed') {
        failed += 1
      }
    }
  }
  return { failed, passed, total }
}

async function main(): Promise<void> {
  const summaryPath = process.env['FLEET_TEST_SUMMARY_PATH']
  const { filter, options } = parseCLI(['vitest', ...process.argv.slice(2)])
  const ctx = await startVitest('test', filter, options)
  const { failed, passed, total } = tallyTestModules(ctx.state.getTestModules())
  if (summaryPath) {
    writeFileSync(summaryPath, JSON.stringify({ failed, passed, total }))
  }
  // Exit-code determination is vitest's own: `startVitest` already sets
  // `process.exitCode` internally once the run finishes (a failed test, an
  // unhandled error, …), the same mechanism the real `vitest` CLI relies on.
  // Mirroring cli.js's own `start()`: close the server unless in watch mode.
  if (!ctx.shouldKeepServer()) {
    await ctx.exit()
  }
}

void main().catch((e: unknown) => {
  logger.fail(e)
  process.exitCode = 1
})
