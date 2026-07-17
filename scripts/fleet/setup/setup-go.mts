#!/usr/bin/env node
/**
 * @file `setup:go` — download Go module dependencies through the locked path, so
 *   a dev machine gets exactly what CI gets. Self-detecting: skips with a clear
 *   line unless the repo has a first-party `go.mod`. Requires `go` (it fails
 *   loud with the install instruction rather than fetching a toolchain), then
 *   runs `go mod download` per `go.mod` dir. `go.mod` records the exact module
 *   versions and `go.sum` carries their integrity hashes, so the download is
 *   verified against the committed lock natively — no extra pin needed.
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findGoModFiles } from '../update/go.mts'
import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type {
  EcosystemStepOptions,
  EcosystemStepResult,
} from './ecosystems.mts'

/**
 * The skip reason for `setup:go`, or undefined when the step should run. Pure
 * over the `go.mod` count so the decision is unit-testable without a
 * filesystem.
 */
export function goSkipReason(options: {
  readonly goModCount: number
}): string | undefined {
  return options.goModCount > 0
    ? undefined
    : 'no first-party go.mod (repo has no Go modules)'
}

/**
 * Download every first-party module's dependencies from the committed `go.mod`
 * / `go.sum`.
 */
export async function setupGo(
  options?: EcosystemStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const { commandExists, logger, repoRoot, runCommand } =
    resolveEcosystemOptions(options)
  const goModFiles = findGoModFiles(repoRoot)
  const skip = goSkipReason({ goModCount: goModFiles.length })
  if (skip) {
    return skipResult(logger, 'setup:go', skip)
  }
  if (!(await commandExists('go'))) {
    logger.fail(
      'setup:go: go is not installed.\n' +
        '  Where: this dev machine (a first-party go.mod is present).\n' +
        '  Saw: no go on PATH; wanted the Go toolchain.\n' +
        '  Fix: install Go from https://go.dev/dl, then re-run pnpm run setup:go.',
    )
    return { ok: false, reason: 'go not installed', skipped: false }
  }
  for (const goModFile of goModFiles) {
    const dir = path.dirname(goModFile)
    logger.log(
      `setup:go — go mod download (${path.relative(repoRoot, dir) || '.'})`,
    )
    const downloaded = await runCommand('go', ['mod', 'download'], { cwd: dir })
    if (downloaded.exitCode !== 0) {
      logger.fail(
        `setup:go: go mod download failed in ${dir}.\n` +
          `  Where: go mod download (cwd ${dir}).\n` +
          `  Saw: exit ${downloaded.exitCode}; wanted every module resolved + integrity-checked against go.sum.\n` +
          '  Fix: run pnpm run update (or go mod tidy) to refresh go.mod/go.sum, then re-run.',
      )
      return { ok: false, reason: 'go mod download failed', skipped: false }
    }
  }
  logger.log(
    `setup:go — downloaded modules for ${goModFiles.length} go.mod file(s).`,
  )
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupGo().then(
    result => {
      if (!result.ok) {
        process.exitCode = 1
      }
    },
    (e: unknown) => {
      getDefaultLogger().error(e)
      process.exitCode = 1
    },
  )
}
