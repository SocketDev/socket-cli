/**
 * @fileoverview Monorepo-aware dependency update script.
 * Uses taze to update dependencies across all packages in the monorepo.
 *
 * Usage:
 *   node scripts/update.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 */

import { isQuiet, isVerbose } from '@socketsecurity/lib/argv/flags'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const logger = getDefaultLogger()

  try {
    if (!quiet) {
      logger.log('\n🔨 Dependency Update\n')
    }

    // Build taze command with appropriate flags for monorepo
    const tazeArgs = ['exec', 'taze', '-r', '-w']

    if (!quiet) {
      logger.progress('Updating dependencies...')
    }

    // Run taze at root level (recursive flag will check all packages).
    const result = await spawn('pnpm', tazeArgs, {
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    // Clear progress line.
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    // Always update Socket packages (bypass taze maturity period).
    if (!quiet) {
      logger.progress('Updating Socket packages...')
    }

    const socketResult = await spawn(
      'pnpm',
      [
        'update',
        '@socketsecurity/*',
        '@socketregistry/*',
        '@socketbin/*',
        '--latest',
        '-r',
      ],
      {
        shell: WIN32,
        stdio: quiet ? 'pipe' : 'inherit',
      },
    )

    // Clear progress line.
    if (!quiet) {
      process.stdout.write('\r\x1b[K')
    }

    if (socketResult.code !== 0) {
      if (!quiet) {
        logger.fail('Failed to update Socket packages')
      }
      process.exitCode = 1
      return
    }

    if (result.code !== 0) {
      if (!quiet) {
        logger.fail('Failed to update dependencies')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        logger.success('Dependencies updated')
        logger.log('')
      }
    }
  } catch (error) {
    if (!quiet) {
      logger.fail(`Update failed: ${error.message}`)
    }
    if (verbose) {
      logger.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(e => {
  const logger = getDefaultLogger()
  logger.error(e)
  process.exitCode = 1
})
