/**
 * Background preflight downloads for optional dependencies.
 *
 * Silently downloads @coana-tech/cli and @socketbin/cli-ai in the background
 * on first CLI run to ensure they're cached for future use.
 *
 * This runs asynchronously and never blocks the main CLI execution.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { downloadPackage } from '@socketsecurity/lib/dlx-package'

import ENV from '../../constants/env.mts'
import { getSocketHomePath } from '../dlx/binary.mts'

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
    const downloads: Array<{ packageSpec: string; binaryName?: string }> = []

    // @coana-tech/cli preflight.
    const coanaVersion = ENV.INLINED_SOCKET_CLI_COANA_VERSION
    if (coanaVersion) {
      const coanaSpec = `@coana-tech/cli@~${coanaVersion}`
      if (!isPackageCached(coanaSpec)) {
        downloads.push({ packageSpec: coanaSpec, binaryName: 'coana' })
      }
    }

    // @socketbin/cli-ai preflight.
    const cliAiVersion = ENV.INLINED_SOCKET_CLI_AI_VERSION
    if (cliAiVersion) {
      const cliAiSpec = `@socketbin/cli-ai@^${cliAiVersion}`
      if (!isPackageCached(cliAiSpec)) {
        downloads.push({ packageSpec: cliAiSpec, binaryName: 'cli-ai' })
      }
    }

    try {
      // Download in background (fire and forget).
      await Promise.all(
        downloads.map(p =>
          downloadPackage({
            package: p.packageSpec,
            binaryName: p.binaryName,
            force: false,
          }),
        ),
      )
    } catch {}
  })()
}
