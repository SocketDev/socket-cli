/**
 * @fileoverview Unified lint runner with flag-based configuration.
 * Provides smart linting that can target affected files or lint everything.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printHeader } from '@socketsecurity/lib/stdio/header'

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
 * Get Biome exclude patterns from biome.json.
 */
function getBiomeExcludePatterns() {
  try {
    const biomeConfigPath = path.join(process.cwd(), 'biome.json')
    if (!existsSync(biomeConfigPath)) {
      return []
    }

    const biomeConfig = JSON.parse(readFileSync(biomeConfigPath, 'utf8'))
    const includes = biomeConfig['files']?.['includes'] ?? []

    // Extract patterns that start with '!' (exclude patterns)
    return (
      includes
        .filter(
          pattern => typeof pattern === 'string' && pattern.startsWith('!'),
        )
        // Remove the '!' prefix
        .map(pattern => pattern.slice(1))
    )
  } catch {
    // If we can't read biome.json, return empty array
    return []
  }
}

/**
 * Check if a file matches any of the exclude patterns.
 */
function isExcludedByBiome(file, excludePatterns) {
  for (const pattern of excludePatterns) {
    // Convert glob pattern to regex-like matching
    // Support **/ for directory wildcards and * for filename wildcards
    const regexPattern = pattern
      // **/ matches any directory
      .replace(/\*\*\//g, '.*')
      // * matches any characters except /
      .replace(/\*/g, '[^/]*')
      // Escape dots
      .replace(/\./g, '\\.')

    const regex = new RegExp(`^${regexPattern}$`)
    if (regex.test(file)) {
      return true
    }
  }
  return false
}

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

  const biomeExcludePatterns = getBiomeExcludePatterns()

  return files.filter(file => {
    const ext = path.extname(file)
    // Only lint files that have lintable extensions AND still exist.
    if (!lintableExtensions.has(ext) || !existsSync(file)) {
      return false
    }

    // Filter out fixture files (third-party test fixtures should not be linted).
    if (
      file.includes('/test/fixtures/') ||
      file.includes('/test\\fixtures\\')
    ) {
      return false
    }

    // Filter out files excluded by biome.json
    if (isExcludedByBiome(file, biomeExcludePatterns)) {
      return false
    }

    return true
  })
}

/**
 * Run linters on specific files.
 */
async function runLintOnFiles(files, options = {}) {
  const { fix = false, quiet = false } = options

  if (!files.length) {
    getDefaultLogger().substep('No files to lint')
    return 0
  }

  if (!quiet) {
    getDefaultLogger().progress(`Linting ${files.length} file(s)`)
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

    try {
      await spawn('pnpm', args, { shell: WIN32 })
    } catch (e) {
      // When fixing, non-zero exit codes are normal if fixes were applied.
      if (!fix || (e.stderr && e.stderr?.toString().trim().length > 0)) {
        if (!quiet) {
          getDefaultLogger().error('Linting failed')
        }
        if (e.stderr) {
          getDefaultLogger().error(e.stderr?.toString() ?? '')
        }
        if (e.stdout && !fix) {
          getDefaultLogger().log(e.stdout?.toString() ?? '')
        }
        return e.code || 1
      }
    }
  }

  if (!quiet) {
    getDefaultLogger().clearLine().done('Linting passed')
    // Add newline after message (use error to write to same stream).
    getDefaultLogger().error('')
  }

  return 0
}

/**
 * Run linters on all files.
 */
async function runLintOnAll(options = {}) {
  const { fix = false, quiet = false } = options

  if (!quiet) {
    getDefaultLogger().progress('Linting all files')
  }

  const linters = [
    {
      args: [
        'exec',
        'biome',
        'check',
        '--log-level=none',
        ...(fix ? ['--write', '--unsafe'] : []),
        'src',
        'scripts',
        'test',
        '.config',
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
        'src',
        'scripts',
        'test',
        '.config',
      ],
      name: 'eslint',
    },
  ]

  for (const { args } of linters) {
    try {
      await spawn('pnpm', args, { shell: WIN32 })
    } catch (e) {
      // When fixing, non-zero exit codes are normal if fixes were applied.
      if (!fix || (e.stderr && e.stderr?.toString().trim().length > 0)) {
        if (!quiet) {
          getDefaultLogger().error('Linting failed')
        }
        if (e.stderr) {
          getDefaultLogger().error(e.stderr?.toString() ?? '')
        }
        if (e.stdout && !fix) {
          getDefaultLogger().log(e.stdout?.toString() ?? '')
        }
        return e.code || 1
      }
    }
  }

  if (!quiet) {
    getDefaultLogger().clearLine().done('Linting passed')
    // Add newline after message (use error to write to same stream)
    getDefaultLogger().error('')
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
      getDefaultLogger().log('Lint Runner')
      getDefaultLogger().log('\nUsage: pnpm lint [options] [files...]')
      getDefaultLogger().log('\nOptions:')
      getDefaultLogger().log('  --help         Show this help message')
      getDefaultLogger().log('  --fix          Automatically fix problems')
      getDefaultLogger().log('  --all          Lint all files')
      getDefaultLogger().log(
        '  --changed      Lint changed files (default behavior)',
      )
      getDefaultLogger().log('  --staged       Lint staged files')
      getDefaultLogger().log('  --quiet, --silent  Suppress progress messages')
      getDefaultLogger().log('\nExamples:')
      getDefaultLogger().log(
        '  pnpm lint                   # Lint changed files (default)',
      )
      getDefaultLogger().log(
        '  pnpm lint --fix             # Fix issues in changed files',
      )
      getDefaultLogger().log('  pnpm lint --all             # Lint all files')
      getDefaultLogger().log(
        '  pnpm lint --staged --fix    # Fix issues in staged files',
      )
      getDefaultLogger().log(
        '  pnpm lint src/index.ts      # Lint specific file(s)',
      )
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Lint Runner')
      getDefaultLogger().log('')
    }

    let exitCode = 0

    // Handle positional arguments (specific files)
    if (positionals.length > 0) {
      const files = filterLintableFiles(positionals)
      if (!quiet) {
        getDefaultLogger().step('Linting specified files')
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
          getDefaultLogger().step('Skipping lint')
          getDefaultLogger().substep(reason)
        }
        exitCode = 0
      } else if (files === 'all') {
        if (!quiet) {
          getDefaultLogger().step(`Linting all files (${reason})`)
        }
        exitCode = await runLintOnAll({
          fix: values.fix,
          quiet,
        })
      } else {
        if (!quiet) {
          const modeText = mode === 'staged' ? 'staged' : 'changed'
          getDefaultLogger().step(`Linting ${modeText} files`)
        }
        exitCode = await runLintOnFiles(files, {
          fix: values.fix,
          quiet,
        })
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        getDefaultLogger().error('')
        getDefaultLogger().log('Lint failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        getDefaultLogger().log('')
        getDefaultLogger().success('All lint checks passed!')
      }
    }
  } catch (error) {
    getDefaultLogger().error(`Lint runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  getDefaultLogger().error(e)
  process.exitCode = 1
})
