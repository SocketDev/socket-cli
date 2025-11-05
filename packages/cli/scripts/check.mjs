/**
 * @fileoverview Unified check runner with flag-based configuration.
 * Runs code quality checks: ESLint and TypeScript type checking.
 */

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'

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
    const logger = getDefaultLogger()
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

  const result = await spawn('pnpm', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: WIN32,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.code !== 0) {
    if (!quiet) {
      logger.error('ESLint check failed')
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

  const result = await spawn('pnpm', ['run', 'type'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: WIN32,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.code !== 0) {
    if (!quiet) {
      logger.error('TypeScript check failed')
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
      logger.log('Check Runner')
      logger.log('\nUsage: pnpm check [options]')
      logger.log('\nOptions:')
      logger.log('  --help         Show this help message')
      logger.log('  --lint         Run ESLint check only')
      logger.log('  --types        Run TypeScript check only')
      logger.log(
        '  --all          Check all files (passes to lint)',
      )
      logger.log(
        '  --staged       Check staged files (passes to lint)',
      )
      logger.log(
        '  --changed      Check changed files (passes to lint)',
      )
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('\nExamples:')
      logger.log(
        '  pnpm check             # Run all checks on changed files',
      )
      logger.log(
        '  pnpm check --all       # Run all checks on all files',
      )
      logger.log('  pnpm check --lint      # Run ESLint only')
      logger.log('  pnpm check --types     # Run TypeScript only')
      logger.log(
        '  pnpm check --lint --staged  # Run ESLint on staged files',
      )
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

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
