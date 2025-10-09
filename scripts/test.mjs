/**
 * @fileoverview Unified test runner that provides a smooth, single-script experience.
 * Defaults to testing staged files (or changed if no staged), with --all flag for full test run.
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

async function runCheck() {
  log.step('Running checks')

  // Run fix (auto-format) quietly.
  log.progress('Formatting code')
  let exitCode = await runCommand('pnpm', ['run', 'fix'], {
    stdio: 'pipe'
  })
  if (exitCode !== 0) {
    log.failed('Formatting failed')
    await runCommand('pnpm', ['run', 'fix'])
    return exitCode
  }
  log.done('Code formatted')

  // Run lint check.
  log.progress('Checking lint')
  exitCode = await runCommand('pnpm', ['run', 'lint'], {
    stdio: 'pipe'
  })
  if (exitCode !== 0) {
    log.failed('Lint check failed')
    await runCommand('pnpm', ['run', 'lint'])
    return exitCode
  }
  log.done('Lint check passed')

  // Run TypeScript check if tsconfig exists.
  const tsconfigPath = path.join(rootPath, 'tsconfig.json')
  const tsconfigCheckPath = path.join(rootPath, '.config', 'tsconfig.check.json')
  const configPath = existsSync(tsconfigCheckPath) ? tsconfigCheckPath : (existsSync(tsconfigPath) ? tsconfigPath : null)

  if (configPath) {
    log.progress('Checking TypeScript')
    const tsconfigArg = configPath === tsconfigPath ? [] : ['-p', configPath]
    exitCode = await runCommand('pnpm', [
      'exec',
      'tsgo',
      '--noEmit',
      ...tsconfigArg
    ], {
      stdio: 'pipe'
    })
    if (exitCode !== 0) {
      log.failed('TypeScript check failed')
      await runCommand('pnpm', [
        'exec',
        'tsgo',
        '--noEmit',
        ...tsconfigArg
      ])
      return exitCode
    }
    log.done('TypeScript check passed')
  }

  return 0
}

async function runBuild() {
  const distPath = path.join(rootPath, 'dist')
  const distIndexPath = path.join(distPath, 'index.js')

  // Check if build is needed.
  if (!existsSync(distPath) || !existsSync(distIndexPath)) {
    log.step('Building project')
    return runCommand('pnpm', ['run', 'build'])
  }
  return 0
}

async function runTests(options = {}) {
  const { all, coverage, positionals, update } = options

  // Prepare vitest arguments.
  const vitestArgs = []

  // Check for vitest config.
  const vitestConfigPath = path.join(rootPath, '.config', 'vitest.config.mts')
  if (existsSync(vitestConfigPath)) {
    vitestArgs.push('--config', '.config/vitest.config.mts')
  }

  vitestArgs.push('run')

  // Add coverage if requested.
  if (coverage) {
    vitestArgs.push('--coverage')
  }

  // Add update if requested.
  if (update) {
    vitestArgs.push('--update')
  }

  // If positional arguments provided, use them directly.
  if (positionals && positionals.length > 0) {
    vitestArgs.push(...positionals)
  } else if (!all) {
    // Default to changed tests detection (this will be handled by vitest's changed mode).
    vitestArgs.push('--changed')
  }

  // Check if we have .env.test file.
  const envTestPath = path.join(rootPath, '.env.test')
  const hasEnvTest = existsSync(envTestPath)

  const nodeOptions = `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${process.env.CI ? 8192 : 4096}`.trim()

  // Run tests with or without dotenvx.
  if (hasEnvTest) {
    return runCommand('pnpm', [
      'exec',
      'dotenvx',
      '-q',
      'run',
      '-f',
      '.env.test',
      '--',
      'vitest',
      ...vitestArgs
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions
      }
    })
  } else {
    return runCommand('pnpm', [
      'exec',
      'vitest',
      ...vitestArgs
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions
      }
    })
  }
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

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm test [options] [test-files...]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log('  --all               Run all tests (default: only changed/staged)')
      console.log('  --fast, --quick     Skip lint/type checks for faster execution')
      console.log('  --skip-checks       Skip lint/type checks (same as --fast)')
      console.log('  --skip-build        Skip the build step')
      console.log('  --cover, --coverage Run tests with code coverage')
      console.log('  --update            Update test snapshots')
      console.log('\nExamples:')
      console.log('  pnpm test                      # Run checks, build, and changed tests')
      console.log('  pnpm test --all                # Run all tests')
      console.log('  pnpm test --fast               # Skip checks for quick testing')
      console.log('  pnpm test --cover              # Run with coverage report')
      console.log('  pnpm test "**/*.test.mts"      # Run specific test pattern')
      process.exitCode = 0
      return
    }

    // Detect lifecycle event.
    const lifecycleEvent = process.env.npm_lifecycle_event || ''
    const isTestCI = lifecycleEvent === 'test-ci'

    // In CI mode, always run all tests.
    if (isTestCI && !values.all) {
      values.all = true
    }

    printHeader('Test Runner')

    // Handle aliases.
    const skipChecks = values.fast || values.quick || values['skip-checks']
    const withCoverage = values.cover || values.coverage

    let exitCode = 0

    // Run checks unless skipped.
    if (!skipChecks) {
      exitCode = await runCheck()
      if (exitCode !== 0) {
        log.error('Checks failed')
        process.exitCode = exitCode
        return
      }
      log.success('All checks passed')
    }

    // Run build unless skipped.
    if (!values['skip-build']) {
      exitCode = await runBuild()
      if (exitCode !== 0) {
        log.error('Build failed')
        process.exitCode = exitCode
        return
      }
    }

    // Run tests.
    log.step(values.all ? 'Running all tests' : 'Running changed tests')
    exitCode = await runTests({
      all: values.all,
      coverage: withCoverage,
      positionals,
      update: values.update
    })

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