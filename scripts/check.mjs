/**
 * @fileoverview Monorepo-aware check runner with flag-based configuration.
 * Runs code quality checks: ESLint and TypeScript type checking across packages.
 */

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'
import colors from 'yoctocolors-cjs'

import {
  getAffectedPackages,
  getPackagesWithScript,
  runPackageScript,
} from './utils/monorepo-helper.mjs'

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
    getDefaultLogger().step('Running ESLint checks')
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
        getDefaultLogger().substep('No changed files, skipping ESLint')
        getDefaultLogger().error('')
      }
      return 0
    }

    packages = getAffectedPackages(changedFiles)

    if (!packages.length) {
      if (!quiet) {
        getDefaultLogger().substep('No affected packages, skipping ESLint')
        getDefaultLogger().error('')
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
    getDefaultLogger().error('')
  }

  return 0
}

/**
 * Run TypeScript type check across all packages with type script.
 */
async function runTypeCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    getDefaultLogger().step('Running TypeScript checks')
  }

  const packages = getPackagesWithScript('type')

  if (!packages.length) {
    if (!quiet) {
      getDefaultLogger().substep('No packages with type checking')
      getDefaultLogger().error('')
    }
    return 0
  }

  // Run type check on each package.
  for (const pkg of packages) {
    const displayName = pkg.displayName || pkg.name

    if (!quiet) {
      getDefaultLogger().progress(`${displayName}: checking types`)
    }

    const result = await spawn(
      'pnpm',
      ['--filter', pkg.name, 'run', 'type'],
      {
        cwd: process.cwd(),
        shell: WIN32,
        stdio: 'pipe',
        stdioString: true,
      },
    )

    if (result.code !== 0) {
      if (!quiet) {
        getDefaultLogger().clearLine()
        getDefaultLogger().log(`${colors.red('✗')} ${displayName}`)
        getDefaultLogger().error('')
      }
      // Always show type errors (even in quiet mode) since they're the actual errors.
      if (result.stdout) {
        getDefaultLogger().log(result.stdout)
      }
      if (result.stderr) {
        getDefaultLogger().error(result.stderr)
      }
      if (!quiet) {
        getDefaultLogger().error('')
        getDefaultLogger().error('Type check failed')
      }
      return result.code
    }

    if (!quiet) {
      getDefaultLogger().clearLine()
      getDefaultLogger().log(`${colors.green('✓')} ${displayName}`)
    }
  }

  if (!quiet) {
    getDefaultLogger().error('')
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
      getDefaultLogger().log('Monorepo Check Runner')
      getDefaultLogger().log('\nUsage: pnpm check [options]')
      getDefaultLogger().log('\nOptions:')
      getDefaultLogger().log('  --help         Show this help message')
      getDefaultLogger().log('  --lint         Run ESLint check only')
      getDefaultLogger().log('  --types        Run TypeScript check only')
      getDefaultLogger().log('  --all          Check all packages')
      getDefaultLogger().log('  --staged       Check packages with staged files')
      getDefaultLogger().log('  --changed      Check packages with changed files')
      getDefaultLogger().log('  --quiet, --silent  Suppress progress messages')
      getDefaultLogger().log('\nExamples:')
      getDefaultLogger().log('  pnpm check             # Run all checks on changed packages')
      getDefaultLogger().log('  pnpm check --all       # Run all checks on all packages')
      getDefaultLogger().log('  pnpm check --lint      # Run ESLint only')
      getDefaultLogger().log('  pnpm check --types     # Run TypeScript only')
      getDefaultLogger().log('  pnpm check --lint --staged  # Run ESLint on staged packages')
      process.exitCode = 0
      return
    }

    const quiet = values.quiet || values.silent
    const runAll = !values.lint && !values.types

    if (!quiet) {
      printHeader('Monorepo Check Runner')
      getDefaultLogger().log('')
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
          getDefaultLogger().error('Checks failed')
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
          getDefaultLogger().error('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    // Run link: validation check
    if (runAll) {
      if (!quiet) {
        getDefaultLogger().step('Validating no link: dependencies')
      }
      const validateResult = await spawn(
        'node',
        ['scripts/validate-no-link-deps.mjs'],
        {
          shell: WIN32,
          stdio: quiet ? 'pipe' : 'inherit',
        },
      )
      if (validateResult.code !== 0) {
        if (!quiet) {
          getDefaultLogger().error('Validation failed')
        }
        process.exitCode = validateResult.code
        return
      }
      if (!quiet) {
        getDefaultLogger().error('')
      }
    }

    // Run bundle dependencies validation check
    if (runAll) {
      if (!quiet) {
        getDefaultLogger().step('Validating bundle dependencies')
      }
      const bundleResult = await spawn(
        'node',
        ['scripts/validate-bundle-deps.mjs'],
        {
          shell: WIN32,
          stdio: quiet ? 'pipe' : 'inherit',
        },
      )
      if (bundleResult.code !== 0) {
        if (!quiet) {
          getDefaultLogger().error('Bundle validation failed')
        }
        process.exitCode = bundleResult.code
        return
      }
      if (!quiet) {
        getDefaultLogger().error('')
      }
    }

    // Run CDN references validation check
    if (runAll) {
      if (!quiet) {
        getDefaultLogger().step('Validating no CDN references')
      }
      const cdnResult = await spawn(
        'node',
        ['scripts/validate-no-cdn-refs.mjs'],
        {
          shell: WIN32,
          stdio: quiet ? 'pipe' : 'inherit',
        },
      )
      if (cdnResult.code !== 0) {
        if (!quiet) {
          getDefaultLogger().error('CDN references validation failed')
        }
        process.exitCode = cdnResult.code
        return
      }
      if (!quiet) {
        getDefaultLogger().error('')
      }
    }

    // Run markdown filenames validation check
    if (runAll) {
      if (!quiet) {
        getDefaultLogger().step('Validating markdown filenames')
      }
      const markdownResult = await spawn(
        'node',
        ['scripts/validate-markdown-filenames.mjs'],
        {
          shell: WIN32,
          stdio: quiet ? 'pipe' : 'inherit',
        },
      )
      if (markdownResult.code !== 0) {
        if (!quiet) {
          getDefaultLogger().error('Markdown filenames validation failed')
        }
        process.exitCode = markdownResult.code
        return
      }
      if (!quiet) {
        getDefaultLogger().error('')
      }
    }

    // Run file size validation check
    if (runAll) {
      if (!quiet) {
        getDefaultLogger().step('Validating file sizes')
      }
      const sizeResult = await spawn(
        'node',
        ['scripts/validate-file-size.mjs'],
        {
          shell: WIN32,
          stdio: quiet ? 'pipe' : 'inherit',
        },
      )
      if (sizeResult.code !== 0) {
        if (!quiet) {
          getDefaultLogger().error('File size validation failed')
        }
        process.exitCode = sizeResult.code
        return
      }
      if (!quiet) {
        getDefaultLogger().error('')
      }
    }

    // Run file count validation check
    if (runAll) {
      if (!quiet) {
        getDefaultLogger().step('Validating file count')
      }
      const countResult = await spawn(
        'node',
        ['scripts/validate-file-count.mjs'],
        {
          shell: WIN32,
          stdio: quiet ? 'pipe' : 'inherit',
        },
      )
      if (countResult.code !== 0) {
        if (!quiet) {
          getDefaultLogger().error('File count validation failed')
        }
        process.exitCode = countResult.code
        return
      }
      if (!quiet) {
        getDefaultLogger().error('')
      }
    }

    if (!quiet) {
      getDefaultLogger().success('All checks passed')
      printFooter()
    }
  } catch (error) {
    getDefaultLogger().error(`Check runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  getDefaultLogger().error(e)
  process.exitCode = 1
})
