/**
 * Background preflight downloads for optional dependencies.
 *
 * Silently downloads dependencies in the background on first CLI run:
 * 1. @coana-tech/cli
 * 2. @cyclonedx/cdxgen
 * 3. Python + socketsecurity (socket-python-cli)
 *
 * Downloads are staggered sequentially to avoid resource contention.
 * This runs asynchronously and never blocks the main CLI execution.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { downloadPackage } from '@socketsecurity/lib/dlx/package'

import ENV from '../../constants/env.mts'
import { ensurePython, ensureSocketPythonCli } from '../python/standalone.mts'

/**
 * Track if preflight downloads have already been initiated.
 */
let preflightRunning = false

/**
 * Run preflight downloads in the background.
 * This never blocks or throws errors.
 * Only runs once per process lifetime.
 */
export function runPreflightDownloads(): void {
  // Only run once.
  if (preflightRunning) {
    return
  }
  preflightRunning = true

  // Don't run in test/CI environments.
  if (ENV.CI || ENV.VITEST) {
    return
  }

  // Run asynchronously in the background.
  void (async () => {
    try {
      // Stagger downloads sequentially with delays to avoid resource contention.
      // Order: coana → delay → cdxgen → delay → Python → socketsecurity.

      // 1. @coana-tech/cli preflight.
      const coanaVersion = ENV.INLINED_SOCKET_CLI_COANA_VERSION
      const coanaSpec = `@coana-tech/cli@${coanaVersion}`
      await downloadPackage({
        package: coanaSpec,
        binaryName: 'coana',
        force: false,
      })

      // Delay before next download (1-3 seconds).
      await sleep(1000 + Math.random() * 2000)

      // 2. @cyclonedx/cdxgen preflight.
      const cdxgenVersion = ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION
      const cdxgenSpec = `@cyclonedx/cdxgen@${cdxgenVersion}`
      await downloadPackage({
        package: cdxgenSpec,
        binaryName: 'cdxgen',
        force: false,
      })

      // Delay before next download (1-3 seconds).
      await sleep(1000 + Math.random() * 2000)

      // 3. Python + socketsecurity (socket-python-cli) preflight.
      const pythonBin = await ensurePython()
      await ensureSocketPythonCli(pythonBin)
    } catch {}
  })()
}
