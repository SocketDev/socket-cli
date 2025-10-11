/**
 * @fileoverview Unified lint runner with flag-based configuration.
 * Defaults to linting staged files (or changed if no staged), with --all flag for full lint.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const WIN32 = process.platform === 'win32'

// Simple inline logger.
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => process.stdout.write(`  ∴ ${msg}`),
  done: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  }
}

function printHeader(title) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'─'.repeat(60)}`)
}

function printFooter(message) {
  console.log(`\n${'─'.repeat(60)}`)
  if (message) {console.log(`  ${colors.green('✓')} ${message}`)}
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    child.on('exit', code => {
      resolve(code || 0)
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

async function runCommandQuiet(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    if (child.stdout) {
      child.stdout.on('data', data => {
        stdout += data
      })
    }

    if (child.stderr) {
      child.stderr.on('data', data => {
        stderr += data
      })
    }

    child.on('exit', code => {
      resolve({ exitCode: code || 0, stdout, stderr })
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

async function getStagedFiles() {
  const result = await runCommandQuiet('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR'
  ])

  if (result.exitCode !== 0) {
    return []
  }

  return result.stdout
    .trim()
    .split('\n')
    .filter(file => file.length > 0)
}

async function getChangedFiles() {
  const result = await runCommandQuiet('git', [
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    'HEAD'
  ])

  if (result.exitCode !== 0) {
    return []
  }

  const diffFiles = result.stdout
    .trim()
    .split('\n')
    .filter(file => file.length > 0)

  // Also get untracked files.
  const untrackedResult = await runCommandQuiet('git', [
    'ls-files',
    '--others',
    '--exclude-standard'
  ])

  const untrackedFiles = untrackedResult.exitCode === 0
    ? untrackedResult.stdout
        .trim()
        .split('\n')
        .filter(file => file.length > 0)
    : []

  return [...new Set([...diffFiles, ...untrackedFiles])]
}

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

  // Patterns to exclude from linting
  const excludePatterns = [
    /^build\/patches\/.*\.json$/,
    /^build\/patches\/.*\.md$/,
    /^scripts\/build\/.*\.json$/,
    /^scripts\/build\/.*\.json5$/,
    /^package\.json$/,
  ]

  return files.filter(file => {
    // Check if file should be excluded
    if (excludePatterns.some(pattern => pattern.test(file))) {
      return false
    }

    const ext = path.extname(file)
    return lintableExtensions.has(ext)
  })
}

async function runESLint(target, options = {}) {
  const { fix = false } = options

  const eslintArgs = [
    'exec',
    'eslint'
  ]

  // Check for ESLint config in .config directory.
  const eslintConfigPath = path.join(rootPath, '.config', 'eslint.config.mjs')
  if (existsSync(eslintConfigPath)) {
    eslintArgs.push('--config', '.config/eslint.config.mjs')
  }

  eslintArgs.push('--report-unused-disable-directives')

  if (fix) {
    eslintArgs.push('--fix')
  }

  // Add target files or directory.
  if (Array.isArray(target)) {
    eslintArgs.push(...target)
  } else {
    eslintArgs.push(target)
  }

  return runCommand('pnpm', eslintArgs)
}

async function main() {
  try {
    // Parse arguments.
    const { positionals, values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        fix: {
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
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm lint [options] [files...]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --all          Lint all files (default: only staged/changed)')
      console.log('  --fix          Automatically fix problems')
      console.log('  --staged       Lint staged files only')
      console.log('  --changed      Lint changed files only')
      console.log('\nExamples:')
      console.log('  pnpm lint                   # Lint staged files (or changed if none staged)')
      console.log('  pnpm lint --all             # Lint all files')
      console.log('  pnpm lint --fix             # Fix issues in staged/changed files')
      console.log('  pnpm lint --all --fix       # Fix all linting issues')
      console.log('  pnpm lint src/index.ts      # Lint specific file(s)')
      process.exitCode = 0
      return
    }

    // Detect lifecycle event.
    const lifecycleEvent = process.env.npm_lifecycle_event || ''
    const isLintCI = lifecycleEvent === 'lint-ci'
    const isPrecommit = lifecycleEvent === 'precommit'
    const isCheck = lifecycleEvent === 'check'

    // In CI mode, always lint all.
    if (isLintCI && !values.all && positionals.length === 0) {
      values.all = true
    }

    // In precommit or check mode, default to staged.
    if ((isPrecommit || isCheck) && !values.all && !values.changed && positionals.length === 0) {
      values.staged = true
    }

    printHeader('Lint Runner')

    let exitCode = 0
    let target = null

    // Handle positional arguments (specific files).
    if (positionals.length > 0) {
      const files = filterLintableFiles(positionals)
      if (files.length === 0) {
        log.step('No lintable files specified')
        process.exitCode = 0
        return
      }
      log.step('Linting specified files')
      target = files
    } else if (values.all) {
      log.step('Linting all files')
      target = '.'
    } else {
      // Default to staged files, fallback to changed.
      let files = []

      if (values.staged || (!values.changed && !values.staged)) {
        // Try staged files first.
        files = await getStagedFiles()
        if (files.length > 0) {
          log.step('Linting staged files')
        }
      }

      if (files.length === 0 && (values.changed || (!values.changed && !values.staged))) {
        // Fallback to changed files.
        files = await getChangedFiles()
        if (files.length > 0) {
          log.step('Linting changed files')
        }
      }

      if (files.length === 0) {
        log.step('No staged or changed files to lint')
        printFooter('No files to lint')
        process.exitCode = 0
        return
      }

      // Filter to lintable files.
      files = filterLintableFiles(files)
      if (files.length === 0) {
        log.step('No lintable files found')
        printFooter('No lintable files')
        process.exitCode = 0
        return
      }

      target = files
    }

    // Run ESLint.
    log.progress(values.fix ? 'Running ESLint with fixes' : 'Running ESLint')
    exitCode = await runESLint(target, { fix: values.fix })

    if (exitCode !== 0) {
      log.failed('Lint failed')
      log.error('Lint check failed')
      process.exitCode = exitCode
    } else {
      log.done('Lint passed')
      printFooter('All lint checks passed!')
    }
  } catch (error) {
    log.error(`Lint runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)