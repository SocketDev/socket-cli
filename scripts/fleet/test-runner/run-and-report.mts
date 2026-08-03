/**
 * @file The "spawn vitest, interpret the result" half of test.mts — split
 *   out to keep test.mts (scope resolution + CLI orchestration) under the
 *   fleet's soft file-size cap. `createVitestRunner(ctx)` closes over the
 *   caller's repo-specific paths/flags and returns the same `runVitest(args,
 *   label, options)` function test.mts's call sites already use.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnSyncOptions } from '@socketsecurity/lib-stable/process/spawn/types'

import { readTestSummaryCounts } from './read-summary.mts'
import {
  allSkippedNotice,
  decideTestOutcome,
  noTestsMatchedNotice,
} from './summary-decision.mts'

export interface VitestRunnerContext {
  readonly log: (msg: string) => void
  readonly rerunHint: string
  readonly rootVitestConfig: string
  readonly runVitestScript: string
  readonly stdio: SpawnSyncOptions['stdio']
  readonly useShell: boolean
  readonly warn: (msg: string) => void
}

export type VitestRunner = (
  vitestArgs: string[],
  label: string,
  options?: { env?: Record<string, string> | undefined } | undefined,
) => number

export function createVitestRunner(ctx: VitestRunnerContext): VitestRunner {
  // Resolve the child env for a vitest spawn, always dropping COVERAGE.
  // Coverage is owned by cover.mts, which spawns the outer vitest DIRECTLY
  // (never via test.mts), so any COVERAGE reaching test.mts belongs to a
  // NESTED run — a subprocess-spawning test re-entered test.mts (via `pnpm
  // test` / a git hook) while the outer coverage run is live. A nested
  // vitest with coverage on would clean the shared coverage/.tmp and ENOENT
  // the outer forks' reports. test.mts never collects coverage itself, so
  // strip it and let the suite run parallel without the clobber.
  function resolveVitestEnv(
    optsEnv: Record<string, string> | undefined,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...optsEnv }
    delete env['COVERAGE']
    return env
  }

  return function runVitest(
    vitestArgs: string[],
    label: string,
    options?: { env?: Record<string, string> | undefined } | undefined,
  ): number {
    const opts = { __proto__: null, ...options } as {
      env?: Record<string, string> | undefined
    }
    // Announce the effective budget tier so a CI log answers "which timeout
    // did the config compute?" without a probe commit — a 30s timeout under
    // a config that should compute 60s on CI is diagnosable from the log.
    ctx.log(
      `Test scope: ${label} (CI=${process.env['CI'] ? 'yes' : 'no'}, budget tier: ${process.env['CI'] ? '60s' : '10s local'})`,
    )
    const configArgs = existsSync(ctx.rootVitestConfig)
      ? ['--config', ctx.rootVitestConfig]
      : []
    const summaryDir = mkdtempSync(
      path.join(os.tmpdir(), 'fleet-test-summary-'),
    )
    const summaryPath = path.join(summaryDir, 'summary.json')
    const r = spawnSync(
      process.execPath,
      [ctx.runVitestScript, ...vitestArgs, ...configArgs],
      // Windows shell-shim rationale: see useShell at the call site.
      {
        shell: ctx.useShell,
        stdio: ctx.stdio,
        env: resolveVitestEnv({
          ...opts.env,
          FLEET_TEST_SUMMARY_PATH: summaryPath,
        }),
      },
    )
    if (r.status !== 0) {
      ctx.log('Tests failed')
      safeDeleteSync(summaryDir)
      return 1
    }
    const counts = readTestSummaryCounts(summaryPath)
    safeDeleteSync(summaryDir)
    if (!counts) {
      ctx.log('All tests passed')
      return 0
    }
    // `ctx.warn`, not `ctx.log`, so `--quiet` can't swallow the verdict —
    // mirrors lint.mts's zeroScopeNotice.
    const outcome = decideTestOutcome(counts)
    if (outcome === 'noTestsMatched') {
      ctx.warn(noTestsMatchedNotice(label))
      return 0
    }
    if (outcome === 'allSkipped') {
      ctx.warn(allSkippedNotice(counts, ctx.rerunHint))
      return 0
    }
    ctx.log('All tests passed')
    return 0
  }
}
