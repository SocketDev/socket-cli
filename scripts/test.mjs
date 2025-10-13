#!/usr/bin/env node
/**
 * @fileoverview Optimized test runner with progress bar.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import WIN32 from '@socketsecurity/registry/lib/constants/WIN32'
import { isQuiet } from '@socketsecurity/registry/lib/argv/flags'
import { logger } from '@socketsecurity/registry/lib/logger'
import { createSectionHeader } from '@socketsecurity/registry/lib/stdio/header'
import { onExit } from '@socketsecurity/registry/lib/signal-exit'
import { spinner } from '@socketsecurity/registry/lib/spinner'

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
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15))
  }
})

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...(WIN32 && { shell: true }),
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
      ...(WIN32 && { shell: true }),
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

async function runCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    logger.step('Running checks')
  }

  // Run fix (auto-format) quietly
  if (!quiet) {
    spinner.start('Formatting code...')
  }

  let result = await runCommandWithOutput('pnpm', ['run', 'fix'])
  if (result.code !== 0) {
    if (!quiet) {
      spinner.fail('Formatting failed')
    }
    if (result.stderr) {
      console.error(result.stderr)
    }
    return result.code
  }
  if (!quiet) {
    spinner.success('Code formatted')
  }

  // Run ESLint
  if (!quiet) {
    spinner.start('Running ESLint...')
  }
  result = await runCommandWithOutput('pnpm', ['run', 'check:lint'])

  if (result.code !== 0) {
    if (!quiet) {
      spinner.fail('ESLint failed')
    }
    if (result.stderr) {
      console.error(result.stderr)
    }
    if (result.stdout) {
      console.log(result.stdout)
    }
    return result.code
  }
  if (!quiet) {
    spinner.success('ESLint passed')
  }

  // Run TypeScript check
  if (!quiet) {
    spinner.start('Checking TypeScript...')
  }
  result = await runCommandWithOutput('pnpm', ['run', 'check:types'])

  if (result.code !== 0) {
    if (!quiet) {
      spinner.fail('TypeScript check failed')
    }
    if (result.stderr) {
      console.error(result.stderr)
    }
    if (result.stdout) {
      console.log(result.stdout)
    }
    return result.code
  }
  if (!quiet) {
    spinner.success('TypeScript check passed')
  }

  return 0
}

async function runBuild() {
  const distIndexPath = path.join(rootPath, 'dist', 'index.mjs')
  if (!existsSync(distIndexPath)) {
    logger.step('Building project')
    return runCommand('pnpm', ['run', 'build'])
  }
  return 0
}

async function runVitestSimple(args, options = {}) {
  const { coverage = false, update = false, quiet = false } = options

  const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
  const vitestPath = path.join(nodeModulesBinPath, vitestCmd)

  const vitestArgs = ['run']

  // Add coverage if requested
  if (coverage) {
    vitestArgs.push('--coverage')
  }

  // Add update if requested
  if (update) {
    vitestArgs.push('--update')
  }

  // Add provided arguments
  if (args && args.length > 0) {
    vitestArgs.push(...args)
  }

  // Clean environment for tests
  const env = { ...process.env }
  delete env.DEBUG
  delete env.NODE_DEBUG
  delete env.NODE_COMPILE_CACHE

  // Suppress debug output unless specifically requested
  env.LOG_LEVEL = 'error'
  env.DEBUG_HIDE_DATE = '1'

  // Set optimized memory settings
  // Suppress unhandled rejections from worker thread cleanup
  env.NODE_OPTIONS = '--max-old-space-size=2048 --unhandled-rejections=warn'

  // Use unified runner for consistent Ctrl+O experience
  if (!quiet && process.stdout.isTTY) {
    const { runTests } = await import('./utils/unified-runner.mjs')
    return runTests(vitestPath, vitestArgs, {
      env,
      cwd: rootPath,
      verbose: false,
    })
  }

  // Fallback to execution with output capture to handle worker termination errors
  const result = await runCommandWithOutput(vitestPath, vitestArgs, {
    cwd: rootPath,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  // Print output if not quiet
  if (!quiet) {
    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
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

async function runTests(options) {
  const { all, coverage, positionals, update, quiet } = options

  // If positional arguments provided, use them directly
  if (positionals && positionals.length > 0) {
    if (!quiet) {
      logger.step(`Running specified tests: ${positionals.join(', ')}`)
    }
    return runVitestSimple(positionals, { coverage, update, quiet })
  }

  // Run all tests by default
  if (!quiet) {
    logger.step('Running all tests')
  }
  return runVitestSimple([], { coverage, update, quiet })
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
        'skip-checks': {
          type: 'boolean',
          default: false,
        },
        all: {
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
      console.log('Test Runner')
      console.log('\nUsage: pnpm test [options] [test-files...]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log(
        '  --fast, --quick     Skip lint/type checks for faster execution',
      )
      console.log(
        '  --skip-checks       Skip lint/type checks (same as --fast)',
      )
      console.log('  --skip-build        Skip the build step')
      console.log('  --cover, --coverage Run tests with code coverage')
      console.log('  --update            Update test snapshots')
      console.log('  --all               Run all tests')
      console.log('  --quiet, --silent   Minimal output')
      console.log('\nExamples:')
      console.log(
        '  pnpm test                      # Run checks, build, and tests',
      )
      console.log(
        '  pnpm test --fast               # Skip checks for quick testing',
      )
      console.log('  pnpm test --cover              # Run with coverage report')
      console.log(
        '  pnpm test "**/*.test.mts"      # Run specific test pattern',
      )
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      console.log(createSectionHeader('Running Tests'))
      console.log()
    }

    // Handle aliases
    const skipChecks = values.fast || values.quick || values['skip-checks']
    const withCoverage = values.cover || values.coverage

    let exitCode = 0

    // Run checks unless skipped
    if (!skipChecks) {
      exitCode = await runCheck({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('')
          console.log('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
      if (!quiet) {
        logger.success('All checks passed')
        console.log()
      }
    }

    // Run build unless skipped
    if (!values['skip-build']) {
      exitCode = await runBuild()
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('')
          console.log('Build failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    // Run tests
    exitCode = await runTests({
      ...values,
      coverage: withCoverage,
      positionals,
      quiet,
    })

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        console.log('Tests failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        console.log()
        logger.success('All tests passed!')
      }
    }
  } catch (error) {
    // Ensure spinner is stopped
    try {
      spinner.stop()
    } catch {}
    logger.error('')
    console.log(`Test runner failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    // Ensure spinner is stopped and cleared
    try {
      spinner.stop()
    } catch {}
    try {
      // Clear any remaining spinner output - multiple times to be sure
      process.stdout.write('\r\x1b[K')
      process.stdout.write('\r')
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
