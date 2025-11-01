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

import { existsSync } from 'node:fs'
import path from 'node:path'

import { downloadPackage } from '@socketsecurity/lib/dlx-package'

import ENV from '../../constants/env.mts'
import { getSocketHomePath } from '../dlx/binary.mts'
import { ensurePython, ensureSocketPythonCli } from '../python/standalone.mts'

/**
 * Delay execution for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Check if a package is already cached by the package manager.
 */
function isPackageCached(packageName: string): boolean {
  // Check if package exists in global node_modules.
  // This is a heuristic - actual cache location varies by package manager.
  const socketHome = getSocketHomePath()
  const cacheMarker = path.join(
    socketHome,
    'cache',
    'preflight',
    packageName.replace(/[/@]/g, '-'),
  )
  return existsSync(cacheMarker)
}

/**
 * Run preflight downloads in the background.
 * This never blocks or throws errors.
 */
export function runPreflightDownloads(): void {
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
      const coanaSpec = `@coana-tech/cli@~${coanaVersion}`
      if (!isPackageCached(coanaSpec)) {
        await downloadPackage({
          package: coanaSpec,
          binaryName: 'coana',
          force: false,
        })
      }

      // Delay before next download.
      await delay(3000)

      // 2. @cyclonedx/cdxgen preflight.
      const cdxgenVersion = ENV.INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION
      const cdxgenSpec = `@cyclonedx/cdxgen@~${cdxgenVersion}`
      if (!isPackageCached(cdxgenSpec)) {
        await downloadPackage({
          package: cdxgenSpec,
          binaryName: 'cdxgen',
          force: false,
        })
      }

      // Delay before next download.
      await delay(3000)

      // 3. Python + socketsecurity (socket-python-cli) preflight.
      const pythonBin = await ensurePython()
      await ensureSocketPythonCli(pythonBin)
    } catch {}
  })()
}
