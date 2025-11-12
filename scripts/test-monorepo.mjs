/**
 * @fileoverview Monorepo-aware test runner with smart file detection.
 * Runs tests across affected packages based on changed files.
 */

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printHeader } from '@socketsecurity/lib/stdio/header'
import colors from 'yoctocolors-cjs'

import {
  getAffectedPackages,
  getPackagesWithScript,
} from './utils/monorepo-helper.mjs'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'


const logger = getDefaultLogger()
/**
 * Get packages to test and determine affected packages.
 */
async function getPackagesToTest(options) {
  const { all, changed, staged } = options

  // If --all, return all packages.
  if (all) {
    return {
      mode: 'all',
      packages: getPackagesWithScript('test'),
      reason: 'all flag specified',
    }
  }

  // Get changed files.
  let changedFiles = []
  let mode = 'changed'

  if (staged) {
    mode = 'staged'
    changedFiles = await getStagedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { mode, packages: [], reason: 'no staged files' }
    }
  } else if (changed) {
    mode = 'changed'
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { mode, packages: [], reason: 'no changed files' }
    }
  } else {
    // Default to changed files if no specific flag.
    mode = 'changed'
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { mode, packages: [], reason: 'no changed files' }
    }
  }

  // Determine affected packages.
  const affectedPackages = getAffectedPackages(changedFiles)

  if (!affectedPackages.length) {
    return { mode, packages: [], reason: 'no testable packages affected' }
  }

  return { mode, packages: affectedPackages, reason: null }
}

/**
 * Run tests on a specific package with pretty output.
 */
async function runPackageTest(pkg, testArgs = [], quiet = false) {
  const displayName = pkg.displayName || pkg.name

  if (!quiet) {
    logger.progress(`${displayName}: running tests`)
  }

  const result = await spawn(
    'pnpm',
    ['--filter', pkg.name, 'run', 'test', ...testArgs],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: WIN32,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  if (result.code !== 0) {
    if (!quiet) {
      logger.clearLine()
      logger.log(`${colors.red('✗')} ${displayName}`)
    }
    if (result.stdout) {
      logger.log(result.stdout)
    }
    if (result.stderr) {
      logger.error(result.stderr)
    }
    return result.code
  }

  if (!quiet) {
    logger.clearLine()
    logger.log(`${colors.green('✓')} ${displayName}`)
  }

  return 0
}

async function main() {
  try {
    // Parse arguments.
    const { positionals, values } = parseArgs({
      options: {
        all: { type: 'boolean', default: false },
        changed: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        silent: { type: 'boolean', default: false },
        staged: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      logger.log('Monorepo Test Runner')
      logger.log('\nUsage: pnpm test [options] [test-args...]')
      logger.log('\nOptions:')
      logger.log('  --help         Show this help message')
      logger.log('  --all          Test all packages')
      logger.log('  --changed      Test packages with changed files (default)')
      logger.log('  --staged       Test packages with staged files')
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('\nExamples:')
      logger.log('  pnpm test                # Test changed packages (default)')
      logger.log('  pnpm test --all          # Test all packages')
      logger.log('  pnpm test --staged       # Test staged packages')
      logger.log('  pnpm test -- --coverage  # Pass args to test runner')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Monorepo Test Runner')
      logger.log('')
    }

    // Get packages to test.
    const { mode, packages, reason } = await getPackagesToTest(values)

    if (!packages.length) {
      if (!quiet) {
        logger.step('Skipping tests')
        logger.substep(reason)
      }
      process.exitCode = 0
      return
    }

    // Display what we're testing.
    if (!quiet) {
      const modeText = mode === 'all' ? 'all packages' : `${mode} packages`
      logger.step(
        `Testing ${modeText} (${packages.length} package${packages.length > 1 ? 's' : ''})`,
      )
      logger.error('') // Blank line.
    }

    // Run tests across affected packages.
    let exitCode = 0
    for (const pkg of packages) {
      const result = await runPackageTest(pkg, positionals, quiet)
      if (result !== 0) {
        exitCode = result
        break
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        logger.log('Tests failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        logger.error('')
        logger.success('All tests passed!')
      }
    }
  } catch (error) {
    logger.error(`Test runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
