/**
 * @fileoverview Monorepo-aware TypeScript type checker.
 * Runs type checking across packages with pretty UI.
 */

import colors from 'yoctocolors-cjs'

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'

import { getPackagesWithScript } from './utils/monorepo-helper.mjs'

const logger = getDefaultLogger()
/**
 * Run type check on a specific package with pretty output.
 */
async function runPackageTypeCheck(pkg, quiet = false) {
  const displayName = pkg.displayName || pkg.name

  if (!quiet) {
    logger.progress(`${displayName}: checking types`)
  }

  const result = await spawn('pnpm', ['--filter', pkg.name, 'run', 'type'], {
    cwd: process.cwd(),
    shell: WIN32,
    stdio: 'pipe',
    stdioString: true,
  })

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
      logger.log('Monorepo Type Checker')
      logger.log('\nUsage: pnpm type [options]')
      logger.log('\nOptions:')
      logger.log('  --help         Show this help message')
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('\nExamples:')
      logger.log('  pnpm type      # Type check all packages')
      logger.log('\nNote: Type checking always runs on all packages due to')
      logger.log('      cross-package TypeScript dependencies.')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Monorepo Type Checker')
      logger.log('')
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
      // Blank line.
      logger.error('')
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
        logger.log('Type checking failed')
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
