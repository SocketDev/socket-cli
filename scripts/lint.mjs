/**
 * @fileoverview Monorepo-aware lint runner with smart file detection.
 * Runs linting across affected packages based on changed files.
 */

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { logger } from '@socketsecurity/lib/logger'
import { printHeader } from '@socketsecurity/lib/stdio/header'

import {
  getAffectedPackages,
  getPackagesWithScript,
  runAcrossPackages,
} from './utils/monorepo-helper.mjs'

/**
 * Get files to lint and determine affected packages.
 */
async function getFilesToLint(options) {
  const { all, changed, staged } = options

  // If --all, return all packages.
  if (all) {
    return {
      mode: 'all',
      packages: getPackagesWithScript('lint'),
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
    return { mode, packages: [], reason: 'no lintable packages affected' }
  }

  return { mode, packages: affectedPackages, reason: null }
}

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        all: { type: 'boolean', default: false },
        changed: { type: 'boolean', default: false },
        fix: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        silent: { type: 'boolean', default: false },
        staged: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('Monorepo Lint Runner')
      console.log('\nUsage: pnpm lint [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --fix          Automatically fix problems')
      console.log('  --all          Lint all packages')
      console.log('  --changed      Lint packages with changed files (default)')
      console.log('  --staged       Lint packages with staged files')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm lint                # Lint changed packages (default)')
      console.log('  pnpm lint --fix          # Fix issues in changed packages')
      console.log('  pnpm lint --all          # Lint all packages')
      console.log('  pnpm lint --staged --fix # Fix issues in staged packages')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Monorepo Lint Runner')
      console.log('')
    }

    // Get files to lint and affected packages.
    const { mode, packages, reason } = await getFilesToLint(values)

    if (!packages.length) {
      if (!quiet) {
        logger.step('Skipping lint')
        logger.substep(reason)
      }
      process.exitCode = 0
      return
    }

    // Display what we're linting.
    if (!quiet) {
      const modeText = mode === 'all' ? 'all packages' : `${mode} packages`
      logger.step(`Linting ${modeText} (${packages.length} package${packages.length > 1 ? 's' : ''})`)
      logger.error('') // Blank line.
    }

    // Run lint across affected packages.
    const lintArgs = values.fix ? ['--fix'] : []
    const exitCode = await runAcrossPackages(packages, 'lint', lintArgs, quiet)

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        console.log('Lint failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        logger.error('')
        logger.success('All lint checks passed!')
      }
    }
  } catch (error) {
    logger.error(`Lint runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
