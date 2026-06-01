/**
 * @file Monorepo-aware TypeScript type checker. Runs type checking across
 *   packages with pretty UI.
 */

import type { PackageInfo } from './util/monorepo-helper.mts'

import colors from 'yoctocolors-cjs'

import { isQuiet } from '@socketsecurity/lib-stable/argv/flag-predicates'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { printFooter } from '@socketsecurity/lib-stable/stdio/footer'
import { printHeader } from '@socketsecurity/lib-stable/stdio/header'

import { getPackagesWithScript } from './util/monorepo-helper.mts'

const logger = getDefaultLogger()
/**
 * Run type check on a specific package with pretty output.
 */
async function runPackageTypeCheck(
  pkg: PackageInfo,
  quiet: boolean = false,
): Promise<number> {
  const displayName = pkg.displayName || pkg.name

  if (!quiet) {
    logger.progress(`${displayName}: checking types`)
  }

  const result = await spawn('pnpm', ['--filter', pkg.name, 'run', 'type'], {
    // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- script runs under pnpm workspace; pnpm sets cwd to the package root so process.cwd() resolves correctly.
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

async function main(): Promise<void> {
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
      logger.log('')
      logger.log('Usage: pnpm type [options]')
      logger.log('')
      logger.log('Options:')
      logger.log('  --help         Show this help message')
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('')
      logger.log('Examples:')
      logger.log('  pnpm type      # Type check all packages')
      logger.log('')
      logger.log('Note: Type checking always runs on all packages due to')
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
    for (let i = 0, { length } = packages; i < length; i += 1) {
      const pkg = packages[i]
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
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Type checker failed: ${message}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
