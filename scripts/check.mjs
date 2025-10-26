/**
 * @fileoverview Monorepo-aware check runner with flag-based configuration.
 * Runs code quality checks: ESLint and TypeScript type checking across packages.
 */

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { logger } from '@socketsecurity/lib/logger'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'
import colors from 'yoctocolors-cjs'

import {
  getAffectedPackages,
  getPackagesWithScript,
  runPackageScript,
} from './utils/monorepo-helper.mjs'
import { runCommandQuiet } from './utils/run-command.mjs'

/**
 * Run ESLint check via lint script on affected packages.
 */
async function runEslintCheck(options = {}) {
  const {
    all = false,
    changed = false,
    quiet = false,
    staged = false,
  } = options

  if (!quiet) {
    logger.step('Running ESLint checks')
  }

  // Determine which packages to check.
  let packages = []

  if (all) {
    packages = getPackagesWithScript('lint')
  } else {
    // Get changed files to determine affected packages.
    let changedFiles = []

    if (staged) {
      changedFiles = await getStagedFiles({ absolute: false })
    } else if (changed) {
      changedFiles = await getChangedFiles({ absolute: false })
    } else {
      changedFiles = await getChangedFiles({ absolute: false })
    }

    if (!changedFiles.length) {
      if (!quiet) {
        logger.substep('No changed files, skipping ESLint')
        logger.error('')
      }
      return 0
    }

    packages = getAffectedPackages(changedFiles)

    if (!packages.length) {
      if (!quiet) {
        logger.substep('No affected packages, skipping ESLint')
        logger.error('')
      }
      return 0
    }
  }

  // Run lint on each package.
  for (const pkg of packages) {
    const exitCode = await runPackageScript(pkg, 'lint', [], quiet)
    if (exitCode !== 0) {
      return exitCode
    }
  }

  if (!quiet) {
    logger.error('')
  }

  return 0
}

/**
 * Run TypeScript type check across all packages with type script.
 */
async function runTypeCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    logger.step('Running TypeScript checks')
  }

  const packages = getPackagesWithScript('type')

  if (!packages.length) {
    if (!quiet) {
      logger.substep('No packages with type checking')
      logger.error('')
    }
    return 0
  }

  // Run type check on each package.
  for (const pkg of packages) {
    const displayName = pkg.displayName || pkg.name

    if (!quiet) {
      logger.progress(`${displayName}: checking types`)
    }

    const result = await runCommandQuiet(
      'pnpm',
      ['--filter', pkg.name, 'run', 'type'],
      { cwd: process.cwd() },
    )

    if (result.exitCode !== 0) {
      if (!quiet) {
        logger.clearLine()
        console.log(`${colors.red('✗')} ${displayName}`)
      }
      if (result.stdout) {
        console.log(result.stdout)
      }
      if (result.stderr) {
        console.error(result.stderr)
      }
      return result.exitCode
    }

    if (!quiet) {
      logger.clearLine()
      console.log(`${colors.green('✓')} ${displayName}`)
    }
  }

  if (!quiet) {
    logger.error('')
  }

  return 0
}

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        help: { type: 'boolean', default: false },
        lint: { type: 'boolean', default: false },
        types: { type: 'boolean', default: false },
        all: { type: 'boolean', default: false },
        staged: { type: 'boolean', default: false },
        changed: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        silent: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('Monorepo Check Runner')
      console.log('\nUsage: pnpm check [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --lint         Run ESLint check only')
      console.log('  --types        Run TypeScript check only')
      console.log('  --all          Check all packages')
      console.log('  --staged       Check packages with staged files')
      console.log('  --changed      Check packages with changed files')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm check             # Run all checks on changed packages')
      console.log('  pnpm check --all       # Run all checks on all packages')
      console.log('  pnpm check --lint      # Run ESLint only')
      console.log('  pnpm check --types     # Run TypeScript only')
      console.log('  pnpm check --lint --staged  # Run ESLint on staged packages')
      process.exitCode = 0
      return
    }

    const quiet = values.quiet || values.silent
    const runAll = !values.lint && !values.types

    if (!quiet) {
      printHeader('Monorepo Check Runner')
      console.log('')
    }

    let exitCode = 0

    // Run ESLint check if requested or running all.
    if (runAll || values.lint) {
      exitCode = await runEslintCheck({
        all: values.all,
        changed: values.changed,
        quiet,
        staged: values.staged,
      })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    // Run TypeScript check if requested or running all.
    if (runAll || values.types) {
      exitCode = await runTypeCheck({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    if (!quiet) {
      logger.success('All checks passed')
      printFooter()
    }
  } catch (error) {
    logger.error(`Check runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
