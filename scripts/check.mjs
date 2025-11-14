/**
 * @fileoverview Monorepo-aware check runner with flag-based configuration.
 * Runs code quality checks: ESLint and TypeScript type checking across packages.
 */

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'

import {
  getAffectedPackages,
  getPackagesWithScript,
  runAcrossPackages,
} from './utils/monorepo-helper.mjs'

const logger = getDefaultLogger()

/**
 * Get files to check and determine affected packages.
 */
async function getFilesToCheck(options) {
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

/**
 * Run ESLint check via lint script on affected packages.
 */
async function runEslintCheck(options = {}) {
  const { quiet = false } = options

  // Get files to check and affected packages.
  const { packages } = await getFilesToCheck(options)

  if (!packages.length) {
    if (!quiet) {
      logger.step('Running ESLint checks')
      logger.substep('No packages to check, skipping ESLint')
    }
    return 0
  }

  // Run lint across affected packages.
  return await runAcrossPackages(packages, 'lint', [], quiet, 'Running ESLint checks')
}

/**
 * Run TypeScript type check across all packages with type script.
 */
async function runTypeCheck(options = {}) {
  const { quiet = false } = options

  const packages = getPackagesWithScript('type')

  if (!packages.length) {
    if (!quiet) {
      logger.step('Running TypeScript checks')
      logger.substep('No packages with type checking')
    }
    return 0
  }

  // Run type check across packages.
  return await runAcrossPackages(packages, 'type', [], quiet, 'Running TypeScript checks')
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
      logger.log('Monorepo Check Runner')
      logger.log('\nUsage: pnpm check [options]')
      logger.log('\nOptions:')
      logger.log('  --help         Show this help message')
      logger.log('  --lint         Run ESLint check only')
      logger.log('  --types        Run TypeScript check only')
      logger.log('  --all          Check all packages')
      logger.log('  --staged       Check packages with staged files')
      logger.log('  --changed      Check packages with changed files')
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('\nExamples:')
      logger.log('  pnpm check             # Run all checks on changed packages')
      logger.log('  pnpm check --all       # Run all checks on all packages')
      logger.log('  pnpm check --lint      # Run ESLint only')
      logger.log('  pnpm check --types     # Run TypeScript only')
      logger.log('  pnpm check --lint --staged  # Run ESLint on staged packages')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)
    const runAll = !values.lint && !values.types

    if (!quiet) {
      printHeader('Monorepo Check Runner')
    }

    let exitCode = 0

    // Run ESLint check if requested or running all.
    if (runAll || values.lint) {
      if (!quiet) {
        logger.log('')
      }
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
      if (!quiet) {
        logger.log('')
      }
      exitCode = await runTypeCheck({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    // Run link: validation check.
    if (runAll) {
      if (!quiet) {
        logger.log('')
        logger.progress('Validating no link: dependencies')
      }
      const validateResult = await spawn(
        'node',
        ['scripts/validate-no-link-deps.mjs'],
        {
          shell: WIN32,
          stdio: 'pipe',
          stdioString: true,
        },
      )
      if (validateResult.code !== 0) {
        if (!quiet) {
          logger.clearLine()
          logger.error('Validation failed')
        }
        // Show the actual error output.
        if (validateResult.stdout) {
          logger.log(validateResult.stdout)
        }
        if (validateResult.stderr) {
          logger.error(validateResult.stderr)
        }
        process.exitCode = validateResult.code
        return
      }
      if (!quiet) {
        logger.clearLine()
        logger.success('No link: dependencies found')
      }
    }

    // Run bundle dependencies validation check.
    if (runAll) {
      if (!quiet) {
        logger.log('')
        logger.progress('Validating bundle dependencies')
      }
      const bundleResult = await spawn(
        'node',
        ['scripts/validate-bundle-deps.mjs'],
        {
          shell: WIN32,
          stdio: 'pipe',
          stdioString: true,
        },
      )
      if (bundleResult.code !== 0) {
        if (!quiet) {
          logger.clearLine()
          logger.error('Bundle validation failed')
        }
        // Show the actual error output.
        if (bundleResult.stdout) {
          logger.log(bundleResult.stdout)
        }
        if (bundleResult.stderr) {
          logger.error(bundleResult.stderr)
        }
        process.exitCode = bundleResult.code
        return
      }
      if (!quiet) {
        logger.clearLine()
        logger.success('Bundle dependencies validation passed')
      }
    }

    // Run CDN references validation check.
    if (runAll) {
      if (!quiet) {
        logger.log('')
        logger.progress('Validating no CDN references')
      }
      const cdnResult = await spawn(
        'node',
        ['scripts/validate-no-cdn-refs.mjs'],
        {
          shell: WIN32,
          stdio: 'pipe',
          stdioString: true,
        },
      )
      if (cdnResult.code !== 0) {
        if (!quiet) {
          logger.clearLine()
          logger.error('CDN references validation failed')
        }
        // Show the actual error output.
        if (cdnResult.stdout) {
          logger.log(cdnResult.stdout)
        }
        if (cdnResult.stderr) {
          logger.error(cdnResult.stderr)
        }
        process.exitCode = cdnResult.code
        return
      }
      if (!quiet) {
        logger.clearLine()
        logger.success('No CDN references found')
      }
    }

    // Run markdown filenames validation check.
    if (runAll) {
      if (!quiet) {
        logger.log('')
        logger.progress('Validating markdown filenames')
      }
      const markdownResult = await spawn(
        'node',
        ['scripts/validate-markdown-filenames.mjs'],
        {
          shell: WIN32,
          stdio: 'pipe',
          stdioString: true,
        },
      )
      if (markdownResult.code !== 0) {
        if (!quiet) {
          logger.clearLine()
          logger.error('Markdown filenames validation failed')
        }
        // Show the actual error output.
        if (markdownResult.stdout) {
          logger.log(markdownResult.stdout)
        }
        if (markdownResult.stderr) {
          logger.error(markdownResult.stderr)
        }
        process.exitCode = markdownResult.code
        return
      }
      if (!quiet) {
        logger.clearLine()
        logger.success('All markdown filenames follow conventions')
      }
    }

    // Run file size validation check.
    if (runAll) {
      if (!quiet) {
        logger.log('')
        logger.progress('Validating file sizes')
      }
      const sizeResult = await spawn(
        'node',
        ['scripts/validate-file-size.mjs'],
        {
          shell: WIN32,
          stdio: 'pipe',
          stdioString: true,
        },
      )
      if (sizeResult.code !== 0) {
        if (!quiet) {
          logger.clearLine()
          logger.error('File size validation failed')
        }
        // Show the actual error output.
        if (sizeResult.stdout) {
          logger.log(sizeResult.stdout)
        }
        if (sizeResult.stderr) {
          logger.error(sizeResult.stderr)
        }
        process.exitCode = sizeResult.code
        return
      }
      if (!quiet) {
        logger.clearLine()
        logger.success('All files are within size limits')
      }
    }

    // Run file count validation check.
    if (runAll) {
      if (!quiet) {
        logger.log('')
        logger.progress('Validating file count')
      }
      const countResult = await spawn(
        'node',
        ['scripts/validate-file-count.mjs'],
        {
          shell: WIN32,
          stdio: 'pipe',
          stdioString: true,
        },
      )
      if (countResult.code !== 0) {
        if (!quiet) {
          logger.clearLine()
          logger.error('File count validation failed')
        }
        // Show the actual error output.
        if (countResult.stdout) {
          logger.log(countResult.stdout)
        }
        if (countResult.stderr) {
          logger.error(countResult.stderr)
        }
        process.exitCode = countResult.code
        return
      }
      if (!quiet) {
        logger.clearLine()
        logger.success('Commit size is acceptable')
      }
    }

    if (!quiet) {
      logger.log('')
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
