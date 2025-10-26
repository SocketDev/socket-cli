/**
 * @fileoverview Monorepo-aware TypeScript type checker.
 * Runs type checking across packages with pretty UI.
 */

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { logger } from '@socketsecurity/lib/logger'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'
import colors from 'yoctocolors-cjs'

import { getPackagesWithScript } from './utils/monorepo-helper.mjs'
import { runCommandQuiet } from './utils/run-command.mjs'

/**
 * Run type check on a specific package with pretty output.
 */
async function runPackageTypeCheck(pkg, quiet = false) {
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

  return 0
}

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        help: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        silent: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('Monorepo Type Checker')
      console.log('\nUsage: pnpm type [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm type      # Type check all packages')
      console.log('\nNote: Type checking always runs on all packages due to')
      console.log('      cross-package TypeScript dependencies.')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Monorepo Type Checker')
      console.log('')
    }

    // Get all packages with type script.
    const packages = getPackagesWithScript('type')

    if (!packages.length) {
      if (!quiet) {
        logger.step('No packages with type checking found')
      }
      process.exitCode = 0
      return
    }

    // Display what we're checking.
    if (!quiet) {
      logger.step(
        `Type checking ${packages.length} package${packages.length > 1 ? 's' : ''}`,
      )
      logger.error('') // Blank line.
    }

    // Run type check across all packages.
    let exitCode = 0
    for (const pkg of packages) {
      const result = await runPackageTypeCheck(pkg, quiet)
      if (result !== 0) {
        exitCode = result
        break
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        console.log('Type checking failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        logger.error('')
        logger.success('All type checks passed!')
        printFooter()
      }
    }
  } catch (error) {
    logger.error(`Type checker failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
