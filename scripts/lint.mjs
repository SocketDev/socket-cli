/**
 * @fileoverview Unified lint runner with flag-based configuration.
 * Provides smart linting that can target affected files or lint everything.
 */

import path from 'node:path'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

import { getChangedFiles, getStagedFiles } from './utils/git.mjs'
import { runCommandQuiet } from './utils/run-command.mjs'

// Simple clean logging without prefixes
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => {
    // Write progress message without newline for in-place updates
    process.stdout.write(`  ∴ ${msg}`)
  },
  done: msg => {
    // Clear current line and write success message
    // Carriage return + clear line
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    // Clear current line and write failure message
    // Carriage return + clear line
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  }
}

// Files that trigger a full lint when changed
const CORE_FILES = new Set([
  'src/logger.ts',
  'src/spawn.ts',
  'src/fs.ts',
  'src/promises.ts',
  'src/objects.ts',
  'src/arrays.ts',
  'src/strings.ts',
  'src/types.ts',
])

// Config patterns that trigger a full lint
const CONFIG_PATTERNS = [
  '.config/**',
  'scripts/utils/**',
  'pnpm-lock.yaml',
  'tsconfig*.json',
  '.oxlintignore',
  'oxlintrc.json',
  'eslint.config.*',
  'biome.json',
]

/**
 * Check if we should run all linters based on changed files.
 */
function shouldRunAllLinters(changedFiles) {
  for (const file of changedFiles) {
    // Core library files
    if (CORE_FILES.has(file)) {
      return { runAll: true, reason: 'core files changed' }
    }

    // Config or infrastructure files
    for (const pattern of CONFIG_PATTERNS) {
      if (file.includes(pattern.replace('**', ''))) {
        return { runAll: true, reason: 'config files changed' }
      }
    }
  }

  return { runAll: false }
}

/**
 * Filter files to only those that should be linted.
 */
function filterLintableFiles(files) {
  const lintableExtensions = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.cts',
    '.mts',
    '.json',
    '.jsonc',
    '.md',
    '.yml',
    '.yaml',
  ])

  return files.filter(file => {
    const ext = path.extname(file)
    return lintableExtensions.has(ext)
  })
}

/**
 * Run ESLint on specific files.
 */
async function runLintOnFiles(files, options = {}) {
  const { fix = false, quiet = false } = options

  if (!files.length) {
    log.substep('No files to lint')
    return 0
  }

  if (!quiet) {
    log.progress(`Linting ${files.length} file(s)`)
  }

  const args = [
    'exec',
    'eslint',
    '--config',
    '.config/eslint.config.mjs',
    '--report-unused-disable-directives',
    ...(fix ? ['--fix'] : []),
    ...files,
  ]

  const result = await runCommandQuiet('pnpm', args)

  if (result.exitCode !== 0) {
    // When fixing, non-zero exit codes are normal if fixes were applied
    if (!fix || (result.stderr && result.stderr.trim().length > 0)) {
      if (!quiet) {
        log.failed(`Linting failed`)
      }
      if (result.stderr) {
        console.error(result.stderr)
      }
      if (result.stdout && !fix) {
        console.log(result.stdout)
      }
      return result.exitCode
    }
  }

  if (!quiet) {
    log.done(`Linting passed`)
  }

  return 0
}

/**
 * Run ESLint on all files.
 */
async function runLintOnAll(options = {}) {
  const { fix = false, quiet = false } = options

  if (!quiet) {
    log.progress('Linting all files')
  }

  const args = [
    'exec',
    'eslint',
    '--config',
    '.config/eslint.config.mjs',
    '--report-unused-disable-directives',
    ...(fix ? ['--fix'] : []),
    '.',
  ]

  const result = await runCommandQuiet('pnpm', args)

  if (result.exitCode !== 0) {
    // When fixing, non-zero exit codes are normal if fixes were applied
    if (!fix || (result.stderr && result.stderr.trim().length > 0)) {
      if (!quiet) {
        log.failed('Linting failed')
      }
      if (result.stderr) {
        console.error(result.stderr)
      }
      if (result.stdout && !fix) {
        console.log(result.stdout)
      }
      return result.exitCode
    }
  }

  if (!quiet) {
    log.done('Linting passed')
  }

  return 0
}

/**
 * Get files to lint based on options.
 */
async function getFilesToLint(options) {
  const { all, changed, staged } = options

  // If --all, return early
  if (all) {
    return { files: 'all', reason: 'all flag specified' }
  }

  // Get changed files
  let changedFiles = []

  if (staged) {
    changedFiles = await getStagedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: null, reason: 'no staged files' }
    }
  } else if (changed) {
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: null, reason: 'no changed files' }
    }
  } else {
    // Default to all if no specific flag
    return { files: 'all', reason: 'no target specified' }
  }

  // Check if we should run all based on changed files
  const { reason, runAll } = shouldRunAllLinters(changedFiles)
  if (runAll) {
    return { files: 'all', reason }
  }

  // Filter to lintable files
  const lintableFiles = filterLintableFiles(changedFiles)
  if (!lintableFiles.length) {
    return { files: null, reason: 'no lintable files changed' }
  }

  return { files: lintableFiles, reason: null }
}

async function main() {
  try {
    // Parse arguments
    const { positionals, values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        fix: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        changed: {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Socket PackageURL Lint Runner')
      console.log('\nUsage: pnpm lint [options] [files...]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --fix          Automatically fix problems')
      console.log('  --all          Lint all files (default if no target specified)')
      console.log('  --changed      Lint changed files')
      console.log('  --staged       Lint staged files')
      console.log('  --quiet        Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm lint                   # Lint all files')
      console.log('  pnpm lint --fix             # Fix all linting issues')
      console.log('  pnpm lint --changed         # Lint changed files')
      console.log('  pnpm lint --staged --fix    # Fix issues in staged files')
      console.log('  pnpm lint src/index.ts      # Lint specific file(s)')
      process.exitCode = 0
      return
    }

    if (!values.quiet) {
      console.log('═══════════════════════════════════════════════════════')
      console.log('  Socket PackageURL Lint Runner')
      console.log('═══════════════════════════════════════════════════════')
    }

    let exitCode = 0

    // Handle positional arguments (specific files)
    if (positionals.length > 0) {
      const files = filterLintableFiles(positionals)
      if (!values.quiet) {
        log.step('Linting specified files')
      }
      exitCode = await runLintOnFiles(files, {
        fix: values.fix,
        quiet: values.quiet
      })
    } else {
      // Get files to lint based on flags
      const { files, reason } = await getFilesToLint(values)

      if (files === null) {
        if (!values.quiet) {
          log.step('Skipping lint')
          log.substep(reason)
        }
        exitCode = 0
      } else if (files === 'all') {
        if (!values.quiet) {
          const reasonText = reason ? ` (${reason})` : ''
          log.step(`Linting all files${reasonText}`)
        }
        exitCode = await runLintOnAll({
          fix: values.fix,
          quiet: values.quiet
        })
      } else {
        if (!values.quiet) {
          log.step('Linting affected files')
        }
        exitCode = await runLintOnFiles(files, {
          fix: values.fix,
          quiet: values.quiet
        })
      }
    }

    if (exitCode !== 0) {
      if (!values.quiet) {
        log.error('Lint failed')
      }
      process.exitCode = exitCode
    } else {
      if (!values.quiet) {
        console.log('\n═══════════════════════════════════════════════════════')
        log.success('All lint checks passed!')
        console.log('═══════════════════════════════════════════════════════')
      }
    }
  } catch (error) {
    log.error(`Lint runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)