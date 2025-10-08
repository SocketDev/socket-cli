/**
 * @fileoverview Unified test runner that provides a smooth, single-script experience.
 * Combines check, build, and test steps with clean, consistent output.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import WIN32 from '@socketsecurity/registry/lib/constants/WIN32'

import { getTestsToRun } from './utils/changed-test-mapper.mjs'
import {
  getRootPath,
  log,
  printFooter,
  printHeader,
  printHelpHeader
} from './utils/common.mjs'

const rootPath = getRootPath(import.meta.url)
const nodeModulesBinPath = path.join(rootPath, 'node_modules', '.bin')

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
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

async function runCheck() {
  log.step('Running checks')

  // Run fix (auto-format) quietly since it has its own output
  log.progress('Formatting code')
  let exitCode = await runCommand('pnpm', ['run', 'fix'], {
    stdio: 'pipe'
  })
  if (exitCode !== 0) {
    log.failed('Formatting failed')
    // Re-run with output to show errors
    await runCommand('pnpm', ['run', 'fix'])
    return exitCode
  }
  log.done('Code formatted')

  // Run ESLint to check for remaining issues
  log.progress('Checking ESLint')
  exitCode = await runCommand('eslint', [
    '--config',
    '.config/eslint.config.mjs',
    '--report-unused-disable-directives',
    '.'
  ], {
    stdio: 'pipe'
  })
  if (exitCode !== 0) {
    log.failed('ESLint failed')
    // Re-run with output to show errors
    await runCommand('eslint', [
      '--config',
      '.config/eslint.config.mjs',
      '--report-unused-disable-directives',
      '.'
    ])
    return exitCode
  }
  log.done('ESLint passed')

  // Run TypeScript check
  log.progress('Checking TypeScript')
  exitCode = await runCommand('tsgo', [
    '--noEmit'
  ], {
    stdio: 'pipe'
  })
  if (exitCode !== 0) {
    log.failed('TypeScript check failed')
    // Re-run with output to show errors
    await runCommand('tsgo', [
      '--noEmit'
    ])
    return exitCode
  }
  log.done('TypeScript check passed')

  return exitCode
}

async function runBuild() {
  const distIndexPath = path.join(rootPath, 'dist', 'index.js')
  if (!existsSync(distIndexPath)) {
    log.step('Building project')
    return runCommand('pnpm', ['run', 'build'])
  }
  return 0
}

async function runTests(options) {
  const { all, coverage, force, staged, update } = options
  const runAll = all || force

  // Get tests to run
  const testInfo = getTestsToRun({ staged, all: runAll })
  const { reason, tests: testsToRun } = testInfo

  // No tests needed
  if (testsToRun === null) {
    log.substep('No relevant changes detected, skipping tests')
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
    const reasonText = reason ? ` (${reason})` : ''
    log.step(`Running all tests${reasonText}`)
  } else {
    log.step(`Running affected tests:`)
    testsToRun.forEach(test => log.substep(test))
    vitestArgs.push(...testsToRun)
  }

  const spawnOptions = {
    cwd: rootPath,
    env: {
      ...process.env,
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${process.env.CI ? 8192 : 4096}`.trim(),
    },
    stdio: 'inherit',
  }

  // Use dotenvx to load test environment
  const dotenvxCmd = WIN32 ? 'dotenvx.cmd' : 'dotenvx'
  const dotenvxPath = path.join(nodeModulesBinPath, dotenvxCmd)

  return runCommand(dotenvxPath, [
    '-q',
    'run',
    '-f',
    '.env.test',
    '--',
    vitestPath,
    ...vitestArgs
  ], spawnOptions)
}

async function main() {
  try {
    // Parse arguments
    const { values } = parseArgs({
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
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      printHelpHeader('Test Runner')
      console.log('\nUsage: pnpm test [options]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log('  --fast, --quick     Skip lint/type checks for faster execution')
      console.log('  --cover, --coverage Run tests with code coverage')
      console.log('  --update            Update test snapshots')
      console.log('  --all, --force      Run all tests regardless of changes')
      console.log('  --staged            Run tests affected by staged changes')
      console.log('  --skip-build        Skip the build step')
      console.log('\nExamples:')
      console.log('  pnpm test                  # Run checks, build, and tests')
      console.log('  pnpm test --fast           # Skip checks for quick testing')
      console.log('  pnpm test --cover          # Run with coverage report')
      console.log('  pnpm test --fast --cover   # Quick test with coverage')
      console.log('  pnpm test --update         # Update test snapshots')
      process.exitCode = 0
      return
    }

    printHeader('Socket PackageURL Test Runner')

    // Handle aliases
    const skipChecks = values.fast || values.quick
    const withCoverage = values.cover || values.coverage

    let exitCode = 0

    // Run checks unless skipped
    if (!skipChecks) {
      exitCode = await runCheck()
      if (exitCode !== 0) {
        log.error('Checks failed')
        process.exitCode = exitCode
        return
      }
      log.success('All checks passed')
    }

    // Run build unless skipped
    if (!values['skip-build']) {
      exitCode = await runBuild()
      if (exitCode !== 0) {
        log.error('Build failed')
        process.exitCode = exitCode
        return
      }
    }

    // Run tests
    exitCode = await runTests({ ...values, coverage: withCoverage })

    if (exitCode !== 0) {
      log.error('Tests failed')
      process.exitCode = exitCode
    } else {
      printFooter('All tests passed!')
    }
  } catch (error) {
    log.error(`Test runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)