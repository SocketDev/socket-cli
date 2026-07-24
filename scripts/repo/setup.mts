import process from 'node:process'

/**
 * @file Developer setup script - checks prerequisites and prepares environment.
 *   Checks and optionally installs:
 *
 *   - Node.js version (>=18.0.0)
 *   - pnpm version (>=10.21.0)
 *   - gh CLI (optional, for cache restoration)
 *   - Homebrew (if needed for installations) Actions:
 *   - Checks for required tools (Node.js, pnpm) and fails if missing
 *   - Auto-installs optional tools (gh CLI, brew/choco) if --install flag
 *     provided
 *   - Verifies installed tools are actually available in PATH before proceeding
 *   - Attempts to restore build cache from CI (only if gh CLI available)
 *   - Reports missing tools with installation instructions Usage: pnpm run setup
 *
 *   # Check prerequisites and restore GitHub cache pnpm run setup --install
 *
 *   Check and auto-install optional tools, then restore cache pnpm run setup
 *   --skip-prereqs # Only restore GitHub cache (skip prerequisite checks) pnpm
 *   run setup --skip-gh-cache # Check prerequisites but skip GitHub cache
 *   restoration pnpm run setup --quiet # Minimal output (for postinstall)
 *   Flags: --install Auto-install missing optional tools (gh CLI)
 *   --skip-prereqs Skip prerequisite checks (for CI use; still attempts cache
 *   restoration) --skip-gh-cache Skip GitHub cache restoration (useful when
 *   cache is corrupt) --quiet Minimal output Note: Setup helpers are also
 *   exported in build-infra/lib/setup-helpers for reuse in other build
 *   scripts.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { restoreCache } from './setup/cache.mts'
import { ensureGhCli } from './setup/installers.mts'
import {
  generateCliExePackages,
  generateCliSentryPackage,
  generateSocketbinPackages,
} from './setup/package-generation.mts'
import { checkPrerequisite, hasCommand } from './setup/version-check.mts'

export { compareVersions } from './setup/version-check.mts'
export { restoreCache } from './setup/cache.mts'

const logger = getDefaultLogger()

const autoInstall = process.argv.includes('--install')
const quiet = process.argv.includes('--quiet')
const skipPrereqs = process.argv.includes('--skip-prereqs')
const skipGhCache = process.argv.includes('--skip-gh-cache')

// Handle --help flag.
const showHelp = process.argv.includes('--help') || process.argv.includes('-h')
if (showHelp) {
  logger.log('')
  logger.log('Socket CLI Developer Setup')
  logger.log('')
  logger.log('Usage:')
  logger.log('  pnpm run setup [options]')
  logger.log('')
  logger.log('Options:')
  logger.log(
    '  --install          Auto-install missing optional tools (gh CLI)',
  )
  logger.log('  --skip-prereqs     Skip prerequisite checks (for CI use)')
  logger.log(
    '  --skip-gh-cache    Skip GitHub cache restoration (useful when cache is corrupt)',
  )
  logger.log('  --quiet            Minimal output')
  logger.log('  --help, -h         Show this help message')
  logger.log('')
  logger.log('Examples:')
  logger.log(
    '  pnpm run setup                      # Check prerequisites and restore cache',
  )
  logger.log(
    '  pnpm run setup --install            # Auto-install optional tools',
  )
  logger.log(
    '  pnpm run setup --skip-gh-cache      # Skip cache (useful if cache is corrupt)',
  )
  logger.log(
    '  pnpm run setup --skip-prereqs       # Skip checks, only restore cache',
  )
  logger.log('')
  process.exitCode = 0
}

/**
 * Main entry point.
 */
async function main(): Promise<number> {
  // Handle --skip-prereqs: skip prerequisite checks, proceed to cache restoration.
  if (skipPrereqs) {
    if (!quiet) {
      logger.log('')
      logger.log('Socket CLI Cache Restoration')
      logger.log('============================')
      logger.log('')
      logger.info('Skipping prerequisite checks (--skip-prereqs)')
      logger.log('')
    }

    // Cache restoration respects --skip-gh-cache flag.
    if (!skipGhCache) {
      const hasGh = await hasCommand('gh')
      if (!hasGh) {
        logger.error('gh CLI not found (required for cache restoration)')
        logger.info('Install from: https://cli.github.com/')
        return 1
      }
      await restoreCache(hasGh)
    } else if (!quiet) {
      logger.info('Skipping GitHub cache restoration (--skip-gh-cache)')
    }

    if (!quiet) {
      logger.log('')
      logger.log('Setup complete!')
      logger.log('')
    }
    return 0
  }

  // Normal setup flow: check prerequisites and restore cache.
  if (!quiet) {
    logger.log('')
    logger.log('Socket CLI Developer Setup')
    logger.log('==========================')
    logger.log('')

    if (autoInstall) {
      logger.info('Auto-install mode enabled (--install)')
      logger.log('')
    }
  }

  logger.log('Checking prerequisites…')
  if (!quiet) {
    logger.log('')
  }

  // Check Node.js.
  const nodeOk = await checkPrerequisite({
    command: 'node',
    minVersion: { major: 18, minor: 0, patch: 0 },
    name: 'Node.js',
    required: true,
  })

  // Check pnpm.
  const pnpmOk = await checkPrerequisite({
    command: 'pnpm',
    minVersion: { major: 10, minor: 21, patch: 0 },
    name: 'pnpm',
    required: true,
  })

  // Check gh CLI (optional, with auto-install).
  const ghOk = await ensureGhCli({ autoInstall })

  if (!quiet) {
    logger.log('')
  }

  if (!nodeOk || !pnpmOk) {
    logger.error(
      'Required prerequisites missing. Please install and try again.',
    )
    if (!quiet) {
      logger.log('')
    }
    if (!nodeOk) {
      logger.info('Node.js: https://nodejs.org/')
    }
    if (!pnpmOk) {
      logger.info('pnpm: npm install -g pnpm')
    }
    return 1
  }

  logger.log('All required prerequisites met!')
  if (!quiet) {
    logger.log('')
  }

  // Generate packages from templates.
  await generateCliSentryPackage({ quiet })
  if (!quiet) {
    logger.log('')
  }

  await generateCliExePackages({ quiet })
  if (!quiet) {
    logger.log('')
  }

  await generateSocketbinPackages({ quiet })

  if (!quiet) {
    logger.log('')
  }

  // Always restore cache after prerequisite checks (unless --skip-gh-cache).
  if (!skipGhCache) {
    await restoreCache(ghOk)
  } else if (!quiet) {
    logger.info('Skipping GitHub cache restoration (--skip-gh-cache)')
  }

  if (!quiet) {
    logger.log('')
    logger.log('Setup complete!')
    logger.log('')
    logger.log('Next steps:')
    logger.log('  pnpm run build    # Build the CLI')
    logger.log('  pnpm test         # Run tests')
    logger.log('  pnpm exec socket  # Run the CLI')
    logger.log('')
  }

  return 0
}

if (!showHelp) {
  main()
    .then((code: number) => {
      process.exitCode = code
    })
    .catch((e: unknown) => {
      const message = errorMessage(e)
      logger.error(message)
      process.exitCode = 1
    })
}
