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

import { spawn } from '@socketsecurity/lib/spawn'

import ENV from '../../constants/env.mts'
import { getSocketHomePath } from '../dlx/binary.mts'
import { detectPackageManager } from '../shadow/runner.mts'

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
 * Mark a package as cached to avoid redundant downloads.
 */
async function markPackageCached(packageName: string): Promise<void> {
  const socketHome = getSocketHomePath()
  const cacheDir = path.join(socketHome, 'cache', 'preflight')
  const cacheMarker = path.join(cacheDir, packageName.replace(/[/@]/g, '-'))

  try {
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(cacheMarker, new Date().toISOString())
  } catch {
    // Silently fail - not critical.
  }
}

/**
 * Download a package via package manager dlx in the background.
 */
async function downloadPackage(packageSpec: string): Promise<void> {
  try {
    const agent = await detectPackageManager()

    let dlxCommand: string
    let dlxArgs: string[]

    switch (agent) {
      case 'pnpm':
        dlxCommand = 'pnpm'
        dlxArgs = ['dlx', packageSpec, '--help']
        break
      case 'yarn':
        dlxCommand = 'yarn'
        dlxArgs = ['dlx', packageSpec, '--help']
        break
      default:
        dlxCommand = 'npx'
        dlxArgs = [packageSpec, '--help']
        break
    }

    // Run in background with output discarded.
    await spawn(dlxCommand, dlxArgs, {
      stdio: 'ignore',
      timeout: 30_000, // 30 second timeout.
    })

    // Mark as cached.
    await markPackageCached(packageSpec)
  } catch {
    // Silently fail - downloads will happen on-demand if needed.
  }
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
    const downloads: Array<{ name: string; spec: string }> = []

    // @coana-tech/cli preflight.
    const coanaVersion = ENV.INLINED_SOCKET_CLI_COANA_VERSION
    if (coanaVersion) {
      const coanaSpec = `@coana-tech/cli@~${coanaVersion}`
      if (!isPackageCached(coanaSpec)) {
        downloads.push({ name: '@coana-tech/cli', spec: coanaSpec })
      }
    }

    // @socketbin/cli-ai preflight.
    const cliAiVersion = ENV.INLINED_SOCKET_CLI_AI_VERSION
    if (cliAiVersion) {
      const cliAiSpec = `@socketbin/cli-ai@^${cliAiVersion}`
      if (!isPackageCached(cliAiSpec)) {
        downloads.push({ name: '@socketbin/cli-ai', spec: cliAiSpec })
      }
    }

    // Download in background (fire and forget).
    for (const pkg of downloads) {
      void downloadPackage(pkg.spec)
    }
  })()
}
