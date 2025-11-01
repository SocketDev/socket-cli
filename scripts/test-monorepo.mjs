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
    getDefaultLogger().progress(`${displayName}: running tests`)
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
      getDefaultLogger().clearLine()
      getDefaultLogger().log(`${colors.red('✗')} ${displayName}`)
    }
    if (result.stdout) {
      getDefaultLogger().log(result.stdout)
    }
    if (result.stderr) {
      getDefaultLogger().error(result.stderr)
    }
    return result.code
  }

  if (!quiet) {
    getDefaultLogger().clearLine()
    getDefaultLogger().log(`${colors.green('✓')} ${displayName}`)
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
      getDefaultLogger().log('Monorepo Test Runner')
      getDefaultLogger().log('\nUsage: pnpm test [options] [test-args...]')
      getDefaultLogger().log('\nOptions:')
      getDefaultLogger().log('  --help         Show this help message')
      getDefaultLogger().log('  --all          Test all packages')
      getDefaultLogger().log('  --changed      Test packages with changed files (default)')
      getDefaultLogger().log('  --staged       Test packages with staged files')
      getDefaultLogger().log('  --quiet, --silent  Suppress progress messages')
      getDefaultLogger().log('\nExamples:')
      getDefaultLogger().log('  pnpm test                # Test changed packages (default)')
      getDefaultLogger().log('  pnpm test --all          # Test all packages')
      getDefaultLogger().log('  pnpm test --staged       # Test staged packages')
      getDefaultLogger().log('  pnpm test -- --coverage  # Pass args to test runner')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Monorepo Test Runner')
      getDefaultLogger().log('')
    }

    // Get packages to test.
    const { mode, packages, reason } = await getPackagesToTest(values)

    if (!packages.length) {
      if (!quiet) {
        getDefaultLogger().step('Skipping tests')
        getDefaultLogger().substep(reason)
      }
      process.exitCode = 0
      return
    }

    // Display what we're testing.
    if (!quiet) {
      const modeText = mode === 'all' ? 'all packages' : `${mode} packages`
      getDefaultLogger().step(
        `Testing ${modeText} (${packages.length} package${packages.length > 1 ? 's' : ''})`,
      )
      getDefaultLogger().error('') // Blank line.
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
        getDefaultLogger().error('')
        getDefaultLogger().log('Tests failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        getDefaultLogger().error('')
        getDefaultLogger().success('All tests passed!')
      }
    }
  } catch (error) {
    getDefaultLogger().error(`Test runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  getDefaultLogger().error(e)
  process.exitCode = 1
})
