import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import { restoreCache } from './setup/cache.mts'
import { ensureGhCli } from './setup/installers.mts'
import {
  generateCliExePackages,
  generateCliSentryPackage,
  generateSocketbinPackages,
} from './setup/package-generation.mts'
import { checkPrerequisite, hasCommand } from './setup/version-check.mts'

import type { ScriptMeta } from '../fleet/process/run-main.mts'

export { compareVersions } from './setup/version-check.mts'
export { restoreCache } from './setup/cache.mts'

const logger = getDefaultLogger()

const autoInstall = process.argv.includes('--install')
const quiet = process.argv.includes('--quiet')
const skipPrereqs = process.argv.includes('--skip-prereqs')
const skipGhCache = process.argv.includes('--skip-gh-cache')

/**
 * Main entry point.
 */
async function restoreSetupCache(): Promise<number> {
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

async function generateSetupPackages(): Promise<void> {
  // Generate packages from templates.
  await generateCliSentryPackage(quiet)
  if (!quiet) {
    logger.log('')
  }

  await generateCliExePackages(quiet)
  if (!quiet) {
    logger.log('')
  }

  await generateSocketbinPackages(quiet)

  if (!quiet) {
    logger.log('')
  }
}

async function main(): Promise<number> {
  if (skipPrereqs) {
    return restoreSetupCache()
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
  const nodeOk = await checkPrerequisite('node', 'Node.js', {
    minVersion: { major: 18, minor: 0, patch: 0 },
    required: true,
  })

  // Check pnpm.
  const pnpmOk = await checkPrerequisite('pnpm', 'pnpm', {
    minVersion: { major: 10, minor: 21, patch: 0 },
    required: true,
  })

  // Check gh CLI, optional, with auto-install.
  const ghOk = await ensureGhCli(autoInstall)

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

  await generateSetupPackages()

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

const SCRIPT_META: ScriptMeta = {
  describe:
    'prepare Socket CLI development dependencies and generated packages',
  help: `Usage: pnpm run setup [flags]
  --install          install the optional GitHub CLI when missing
  --skip-prereqs     skip prerequisite checks
  --skip-gh-cache    skip GitHub cache restoration
  --quiet            suppress status output`,
  json: 'result',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
