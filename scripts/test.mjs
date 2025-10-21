/**
 * @fileoverview Unified test runner that provides a smooth, single-script experience.
 * Combines check, build, and test steps with clean, consistent output.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { logger } from '@socketsecurity/lib/logger'
import { onExit } from '@socketsecurity/lib/signal-exit'
import { spinner } from '@socketsecurity/lib/spinner'
import { printHeader } from '@socketsecurity/lib/stdio/header'

import { getTestsToRun } from './utils/changed-test-mapper.mjs'

const WIN32 = process.platform === 'win32'

// Suppress non-fatal worker termination unhandled rejections
process.on('unhandledRejection', (reason, _promise) => {
  const errorMessage = String(reason?.message || reason || '')
  // Filter out known non-fatal worker termination errors
  if (
    errorMessage.includes('Terminating worker thread') ||
    errorMessage.includes('ThreadTermination')
  ) {
    // Ignore these - they're cleanup messages from vitest worker threads
    return
  }
  // Re-throw other unhandled rejections
  throw reason
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const nodeModulesBinPath = path.join(rootPath, 'node_modules', '.bin')

// Track running processes for cleanup
const runningProcesses = new Set()

// Setup exit handler
const removeExitHandler = onExit((_code, signal) => {
  // Stop spinner first
  try {
    spinner.stop()
  } catch {}

  // Kill all running processes
  for (const child of runningProcesses) {
    try {
      child.kill('SIGTERM')
    } catch {}
  }

  if (signal) {
    console.log(`\nReceived ${signal}, cleaning up...`)
    // Let onExit handle the exit with proper code
    process.exitCode = 128 + (signal === 'SIGINT' ? 2 : 15)
  }
})

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...(process.platform === 'win32' && { shell: true }),
      ...options,
    })

    runningProcesses.add(child)

    child.on('exit', code => {
      runningProcesses.delete(child)
      resolve(code || 0)
    })

    child.on('error', error => {
      runningProcesses.delete(child)
      reject(error)
    })
  })
}

async function runCommandWithOutput(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      ...(process.platform === 'win32' && { shell: true }),
      ...options,
    })

    runningProcesses.add(child)

    if (child.stdout) {
      child.stdout.on('data', data => {
        stdout += data.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on('data', data => {
        stderr += data.toString()
      })
    }

    child.on('exit', code => {
      runningProcesses.delete(child)
      resolve({ code: code || 0, stdout, stderr })
    })

    child.on('error', error => {
      runningProcesses.delete(child)
      reject(error)
    })
  })
}

async function runCheck() {
  logger.step('Running checks')

  // Run fix (auto-format) quietly since it has its own output
  spinner.start('Formatting code...')
  let exitCode = await runCommand('pnpm', ['run', 'fix'], {
    stdio: 'pipe',
  })
  if (exitCode !== 0) {
    spinner.stop()
    logger.error('Formatting failed')
    // Re-run with output to show errors
    await runCommand('pnpm', ['run', 'fix'])
    return exitCode
  }
  spinner.stop()
  logger.success('Code formatted')

  // Run ESLint to check for remaining issues
  spinner.start('Running ESLint...')
  exitCode = await runCommand(
    'eslint',
    [
      '--config',
      '.config/eslint.config.mjs',
      '--report-unused-disable-directives',
      '.',
    ],
    {
      stdio: 'pipe',
    },
  )
  if (exitCode !== 0) {
    spinner.stop()
    logger.error('ESLint failed')
    // Re-run with output to show errors
    await runCommand('eslint', [
      '--config',
      '.config/eslint.config.mjs',
      '--report-unused-disable-directives',
      '.',
    ])
    return exitCode
  }
  spinner.stop()
  logger.success('ESLint passed')

  // Run TypeScript check
  spinner.start('Checking TypeScript...')
  exitCode = await runCommand(
    'tsgo',
    ['--noEmit', '-p', '.config/tsconfig.check.json'],
    {
      stdio: 'pipe',
    },
  )
  if (exitCode !== 0) {
    spinner.stop()
    logger.error('TypeScript check failed')
    // Re-run with output to show errors
    await runCommand('tsgo', ['--noEmit', '-p', '.config/tsconfig.check.json'])
    return exitCode
  }
  spinner.stop()
  logger.success('TypeScript check passed')

  return exitCode
}

async function runBuild() {
  const distIndexPath = path.join(rootPath, 'dist', 'index.js')
  if (!existsSync(distIndexPath)) {
    logger.step('Building project')
    return runCommand('pnpm', ['run', 'build'])
  }
  return 0
}

async function runTests(options, positionals = []) {
  const { all, coverage, force, staged, update } = options
  const runAll = all || force

  // Get tests to run
  const testInfo = getTestsToRun({ staged, all: runAll })
  const { mode, reason, tests: testsToRun } = testInfo

  // No tests needed
  if (testsToRun === null) {
    logger.substep('No relevant changes detected, skipping tests')
    return 0
  }

  // Prepare vitest command
  const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
  const vitestPath = path.join(nodeModulesBinPath, vitestCmd)

  const vitestArgs = ['--config', '.config/vitest.config.mts', 'run']

  // Add coverage if requested
  if (coverage) {
    vitestArgs.push('--coverage')
  }

  // Add update if requested
  if (update) {
    vitestArgs.push('--update')
  }

  // Add test patterns if not running all
  if (testsToRun === 'all') {
    logger.step(`Running all tests (${reason})`)
  } else {
    const modeText = mode === 'staged' ? 'staged' : 'changed'
    logger.step(`Running tests for ${modeText} files:`)
    testsToRun.forEach(test => logger.substep(test))
    vitestArgs.push(...testsToRun)
  }

  // Add any additional positional arguments
  if (positionals.length > 0) {
    vitestArgs.push(...positionals)
  }

  const spawnOptions = {
    cwd: rootPath,
    env: {
      ...process.env,
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${process.env.CI ? 8192 : 4096} --unhandled-rejections=warn`.trim(),
    },
    stdio: 'inherit',
  }

  // Use dotenvx to load test environment
  const dotenvxCmd = WIN32 ? 'dotenvx.cmd' : 'dotenvx'
  const dotenvxPath = path.join(nodeModulesBinPath, dotenvxCmd)

  // Use interactive runner for interactive Ctrl+O experience when appropriate
  if (process.stdout.isTTY) {
    const { runTests } = await import('./utils/interactive-runner.mjs')
    return runTests(
      dotenvxPath,
      ['-q', 'run', '-f', '.env.test', '--', vitestPath, ...vitestArgs],
      {
        env: spawnOptions.env,
        cwd: spawnOptions.cwd,
        verbose: false,
      },
    )
  }

  // Fallback to execution with output capture to handle worker termination errors
  const result = await runCommandWithOutput(
    dotenvxPath,
    ['-q', 'run', '-f', '.env.test', '--', vitestPath, ...vitestArgs],
    {
      ...spawnOptions,
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  )

  // Print output
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }

  // Check if we have worker termination error but no test failures
  const hasWorkerTerminationError =
    (result.stdout + result.stderr).includes('Terminating worker thread') ||
    (result.stdout + result.stderr).includes('ThreadTermination')

  const output = result.stdout + result.stderr
  const hasTestFailures =
    output.includes('FAIL') ||
    (output.includes('Test Files') && output.match(/(\d+) failed/) !== null) ||
    (output.includes('Tests') && output.match(/Tests\s+\d+ failed/) !== null)

  // Override exit code if we only have worker termination errors
  if (result.code !== 0 && hasWorkerTerminationError && !hasTestFailures) {
    return 0
  }

  return result.code
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
        fast: {
          type: 'boolean',
          default: false,
        },
        quick: {
          type: 'boolean',
          default: false,
        },
        'skip-build': {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        force: {
          type: 'boolean',
          default: false,
        },
        cover: {
          type: 'boolean',
          default: false,
        },
        coverage: {
          type: 'boolean',
          default: false,
        },
        update: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Test Runner')
      console.log('\nUsage: pnpm test [options] [-- vitest-args...]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log(
        '  --fast, --quick     Skip lint/type checks for faster execution',
      )
      console.log('  --cover, --coverage Run tests with code coverage')
      console.log('  --update            Update test snapshots')
      console.log('  --all, --force      Run all tests regardless of changes')
      console.log('  --staged            Run tests affected by staged changes')
      console.log('  --skip-build        Skip the build step')
      console.log('\nExamples:')
      console.log(
        '  pnpm test                  # Run checks, build, and tests for changed files',
      )
      console.log('  pnpm test --all            # Run all tests')
      console.log(
        '  pnpm test --fast           # Skip checks for quick testing',
      )
      console.log('  pnpm test --cover          # Run with coverage report')
      console.log('  pnpm test --fast --cover   # Quick test with coverage')
      console.log('  pnpm test --update         # Update test snapshots')
      console.log('  pnpm test -- --reporter=dot # Pass args to vitest')
      process.exitCode = 0
      return
    }

    printHeader('Test Runner')

    // Handle aliases
    const skipChecks = values.fast || values.quick
    const withCoverage = values.cover || values.coverage

    let exitCode = 0

    // Run checks unless skipped
    if (!skipChecks) {
      exitCode = await runCheck()
      if (exitCode !== 0) {
        logger.error('Checks failed')
        process.exitCode = exitCode
        return
      }
      logger.success('All checks passed')
    }

    // Run build unless skipped
    if (!values['skip-build']) {
      exitCode = await runBuild()
      if (exitCode !== 0) {
        logger.error('Build failed')
        process.exitCode = exitCode
        return
      }
    }

    // Run tests
    exitCode = await runTests(
      { ...values, coverage: withCoverage },
      positionals,
    )

    if (exitCode !== 0) {
      logger.error('Tests failed')
      process.exitCode = exitCode
    } else {
      logger.success('All tests passed!')
    }
  } catch (error) {
    // Ensure spinner is stopped
    try {
      spinner.stop()
    } catch {}
    logger.error(`Test runner failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    // Ensure spinner is stopped
    try {
      spinner.stop()
    } catch {}
    removeExitHandler()
    // Explicitly exit to prevent hanging
    process.exit(process.exitCode || 0)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
