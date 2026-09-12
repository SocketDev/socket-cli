/**
 * Background preflight downloads for optional dependencies.
 *
 * Silently downloads dependencies in the background on first CLI run: 1.
 *
 * @coana-tech/cli and Python + socketsecurity
 * (socket-python-cli)
 *
 * Downloads are staggered sequentially to avoid resource contention. This runs
 * asynchronously and never blocks the main CLI execution.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { downloadNpmPackage } from '@socketsecurity/lib-stable/dlx/package'

import { isCI } from '@socketsecurity/lib-stable/env/ci'

import { getCoanaVersion } from '../../env/coana-version.mts'
import { VITEST } from '../../env/vitest.mts'
import { ensurePythonDlx, ensureSocketPyCli } from '../python/standalone.mts'

/**
 * Track if preflight downloads have already been initiated.
 */
let preflightRunning = false

/**
 * Run preflight downloads in the background. This never blocks or throws
 * errors. Only runs once per process lifetime.
 */
export function runPreflightDownloads(): void {
  // Only run once.
  if (preflightRunning) {
    return
  }
  preflightRunning = true

  // Don't run in test/CI environments.
  if (isCI() || VITEST) {
    return
  }

  // Run asynchronously in the background.
  void (async () => {
    try {
      // Stagger downloads sequentially with delays to avoid resource contention.

      // 1. @coana-tech/cli preflight.
      const coanaVersion = getCoanaVersion()
      const coanaSpec = `@coana-tech/cli@${coanaVersion}`
      await downloadNpmPackage({
        binaryName: 'coana',
        force: false,
        spec: coanaSpec,
      })

      // Delay before next download to avoid resource contention.
      await sleep(2000)

      // Python + socketsecurity (socket-python-cli) preflight.
      const pythonBin = await ensurePythonDlx()
      await ensureSocketPyCli(pythonBin)
    } catch {}
  })()
}
