/**
 * @fileoverview Unified check runner with flag-based configuration.
 * Runs code quality checks: ESLint and TypeScript type checking.
 */

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { logger } from '@socketsecurity/lib/logger'
import {
  printFooter,
  printHeader,
} from '@socketsecurity/lib/stdio/header'

import { runCommandQuiet } from './utils/run-command.mjs'

/**
 * Run ESLint check via lint script.
 */
async function runEslintCheck(options = {}) {
  const {
    all = false,
    changed = false,
    quiet = false,
    staged = false,
  } = options

  if (!quiet) {
    logger.progress('Checking ESLint')
  }

  const args = ['run', 'lint']
  if (all) {
    args.push('--all')
  } else if (staged) {
    args.push('--staged')
  } else if (changed) {
    args.push('--changed')
  }

  const result = await runCommandQuiet('pnpm', args)

  if (result.exitCode !== 0) {
    if (!quiet) {
      logger.error('ESLint check failed')
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
    logger.clearLine().done('ESLint check passed')
    // Add newline after message (use error to write to same stream)
    logger.error('')
  }

  return 0
}

/**
 * Run TypeScript type check.
 */
async function runTypeCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    logger.progress('Checking TypeScript')
  }

  const result = await runCommandQuiet('pnpm', ['run', 'type'])

  if (result.exitCode !== 0) {
    if (!quiet) {
      logger.error('TypeScript check failed')
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
    logger.clearLine().done('TypeScript check passed')
    // Add newline after message (use error to write to same stream)
    logger.error('')
  }

  return 0
}

async function main() {
  try {
    // Parse arguments
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        lint: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
        changed: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Check Runner')
      console.log('\nUsage: pnpm check [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --lint         Run ESLint check only')
      console.log('  --types        Run TypeScript check only')
      console.log('  --all          Check all files (passes to lint)')
      console.log('  --staged       Check staged files (passes to lint)')
      console.log('  --changed      Check changed files (passes to lint)')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm check             # Run all checks on changed files')
      console.log('  pnpm check --all       # Run all checks on all files')
      console.log('  pnpm check --lint      # Run ESLint only')
      console.log('  pnpm check --types     # Run TypeScript only')
      console.log('  pnpm check --lint --staged  # Run ESLint on staged files')
      process.exitCode = 0
      return
    }

    const quiet = values.quiet || values.silent
    const runAll = !values.lint && !values.types

    if (!quiet) {
      printHeader('Check Runner')
      logger.step('Running code quality checks')
    }

    let exitCode = 0

    // Run ESLint check if requested or running all
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

    // Run TypeScript check if requested or running all
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

main().catch(console.error)
