/**
 * @fileoverview Monorepo-aware dependency update script - checks and updates dependencies.
 * Uses taze to check for updates across all packages in the monorepo.
 *
 * Usage:
 *   node scripts/update.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 *   --apply    Apply updates (default is check-only)
 */

import { isQuiet, isVerbose } from '@socketsecurity/lib/argv/flags'
import loggerPkg from '@socketsecurity/lib/logger'
import platformPkg from '@socketsecurity/lib/constants/platform'
import spawnPkg from '@socketsecurity/lib/spawn'

const { getDefaultLogger } = loggerPkg
const { WIN32 } = platformPkg
const { spawn } = spawnPkg

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const apply = process.argv.includes('--apply')
  const logger = getDefaultLogger()

  try {
    if (!quiet) {
      logger.log('\n🔨 Monorepo Dependency Update\n')
    }

    // Build taze command with appropriate flags for monorepo.
    const tazeArgs = ['exec', 'taze', '-r']

    if (apply) {
      tazeArgs.push('-w')
      if (!quiet) {
        logger.progress('Updating dependencies across monorepo...')
      }
    } else {
      if (!quiet) {
        logger.progress('Checking for updates across monorepo...')
      }
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

    // If applying updates, also update Socket packages.
    if (apply && result.code === 0) {
      if (!quiet) {
        logger.progress('Updating Socket packages...')
      }

      const socketResult = await spawn(
        'pnpm',
        [
          'update',
          '@socketsecurity/*',
          '@socketregistry/*',
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
    }

    if (result.code !== 0) {
      if (!quiet) {
        if (apply) {
          logger.fail('Failed to update dependencies')
        } else {
          logger.info('Updates available. Run with --apply to update')
        }
      }
      process.exitCode = apply ? 1 : 0
    } else {
      if (!quiet) {
        if (apply) {
          logger.success('Dependencies updated across all packages')
        } else {
          logger.success('All packages up to date')
        }
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
