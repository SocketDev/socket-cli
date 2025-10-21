/**
 * @fileoverview Unified lint runner with flag-based configuration.
 * Provides smart linting that can target affected files or lint everything.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { logger } from '@socketsecurity/lib/logger'
import { printHeader } from '@socketsecurity/lib/stdio/header'

import { runCommandQuiet } from './utils/run-command.mjs'

// Files that trigger a full lint when changed
const CORE_FILES = new Set([
  'src/constants.ts',
  'src/error.ts',
  'src/helpers.ts',
  'src/lang.ts',
  'src/objects.ts',
  'src/strings.ts',
  'src/validate.ts',
  'src/purl-type.ts',
])

// Config patterns that trigger a full lint
const CONFIG_PATTERNS = [
  '.config/**',
  'scripts/utils/**',
  'pnpm-lock.yaml',
  'tsconfig*.json',
  'eslint.config.*',
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
    // Only lint files that have lintable extensions AND still exist.
    return lintableExtensions.has(ext) && existsSync(file)
  })
}

/**
 * Run linters on specific files.
 */
async function runLintOnFiles(files, options = {}) {
  const { fix = false, quiet = false } = options

  if (!files.length) {
    logger.substep('No files to lint')
    return 0
  }

  if (!quiet) {
    logger.progress(`Linting ${files.length} file(s)`)
  }

  // Build the linter configurations.
  const linters = [
    {
      args: [
        'exec',
        'biome',
        'check',
        '--log-level=none',
        ...(fix ? ['--write', '--unsafe'] : []),
        ...files,
      ],
      name: 'biome',
      enabled: true,
    },
    {
      args: [
        'exec',
        'eslint',
        '-c',
        '.config/eslint.config.mjs',
        '--report-unused-disable-directives',
        ...(fix ? ['--fix'] : []),
        ...files,
      ],
      name: 'eslint',
      enabled: true,
    },
  ]

  for (const { args, enabled } of linters) {
    if (!enabled) {
      continue
    }

    const result = await runCommandQuiet('pnpm', args)

    if (result.exitCode !== 0) {
      // When fixing, non-zero exit codes are normal if fixes were applied.
      if (!fix || (result.stderr && result.stderr.trim().length > 0)) {
        if (!quiet) {
          logger.error('Linting failed')
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
  }

  if (!quiet) {
    logger.clearLine().done('Linting passed')
    // Add newline after message (use error to write to same stream)
    logger.error('')
  }

  return 0
}

/**
 * Run linters on all files.
 */
async function runLintOnAll(options = {}) {
  const { fix = false, quiet = false } = options

  if (!quiet) {
    logger.progress('Linting all files')
  }

  const linters = [
    {
      args: [
        'exec',
        'biome',
        'check',
        ...(fix ? ['--write', '--unsafe'] : []),
        '.',
      ],
      name: 'biome',
    },
    {
      args: [
        'exec',
        'eslint',
        '-c',
        '.config/eslint.config.mjs',
        '--report-unused-disable-directives',
        ...(fix ? ['--fix'] : []),
        '.',
      ],
      name: 'eslint',
    },
  ]

  for (const { args } of linters) {
    const result = await runCommandQuiet('pnpm', args)

    if (result.exitCode !== 0) {
      // When fixing, non-zero exit codes are normal if fixes were applied.
      if (!fix || (result.stderr && result.stderr.trim().length > 0)) {
        if (!quiet) {
          logger.error('Linting failed')
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
  }

  if (!quiet) {
    logger.clearLine().done('Linting passed')
    // Add newline after message (use error to write to same stream)
    logger.error('')
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
    return { files: 'all', reason: 'all flag specified', mode: 'all' }
  }

  // Get changed files
  let changedFiles = []
  // Track what mode we're in
  let mode = 'changed'

  if (staged) {
    mode = 'staged'
    changedFiles = await getStagedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: null, reason: 'no staged files', mode }
    }
  } else if (changed) {
    mode = 'changed'
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: null, reason: 'no changed files', mode }
    }
  } else {
    // Default to changed files if no specific flag
    mode = 'changed'
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: null, reason: 'no changed files', mode }
    }
  }

  // Check if we should run all based on changed files
  const { reason, runAll } = shouldRunAllLinters(changedFiles)
  if (runAll) {
    return { files: 'all', reason, mode: 'all' }
  }

  // Filter to lintable files
  const lintableFiles = filterLintableFiles(changedFiles)
  if (!lintableFiles.length) {
    return { files: null, reason: 'no lintable files changed', mode }
  }

  return { files: lintableFiles, reason: null, mode }
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
        silent: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Lint Runner')
      console.log('\nUsage: pnpm lint [options] [files...]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --fix          Automatically fix problems')
      console.log('  --all          Lint all files')
      console.log('  --changed      Lint changed files (default behavior)')
      console.log('  --staged       Lint staged files')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log(
        '  pnpm lint                   # Lint changed files (default)',
      )
      console.log('  pnpm lint --fix             # Fix issues in changed files')
      console.log('  pnpm lint --all             # Lint all files')
      console.log('  pnpm lint --staged --fix    # Fix issues in staged files')
      console.log('  pnpm lint src/index.ts      # Lint specific file(s)')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Lint Runner')
      console.log('')
    }

    let exitCode = 0

    // Handle positional arguments (specific files)
    if (positionals.length > 0) {
      const files = filterLintableFiles(positionals)
      if (!quiet) {
        logger.step('Linting specified files')
      }
      exitCode = await runLintOnFiles(files, {
        fix: values.fix,
        quiet,
      })
    } else {
      // Get files to lint based on flags
      const { files, mode, reason } = await getFilesToLint(values)

      if (files === null) {
        if (!quiet) {
          logger.step('Skipping lint')
          logger.substep(reason)
        }
        exitCode = 0
      } else if (files === 'all') {
        if (!quiet) {
          logger.step(`Linting all files (${reason})`)
        }
        exitCode = await runLintOnAll({
          fix: values.fix,
          quiet,
        })
      } else {
        if (!quiet) {
          const modeText = mode === 'staged' ? 'staged' : 'changed'
          logger.step(`Linting ${modeText} files`)
        }
        exitCode = await runLintOnFiles(files, {
          fix: values.fix,
          quiet,
        })
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        console.log('Lint failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        console.log('')
        logger.success('All lint checks passed!')
      }
    }
  } catch (error) {
    logger.error(`Lint runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)
