/**
 * @fileoverview Check script that runs lint and TypeScript checks.
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
  if (message) {
    console.log(`  ${colors.green('✓')} ${message}`)
  }
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

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        lint: {
          type: 'boolean',
          default: false,
        },
        type: {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm check [options]')
      console.log('\nOptions:')
      console.log('  --help    Show this help message')
      console.log('  --all     Check all files (default: only staged/changed)')
      console.log('  --lint    Run lint check only')
      console.log('  --type    Run TypeScript check only')
      console.log('  --staged  Check staged files only')
      console.log('\nExamples:')
      console.log('  pnpm check         # Run all checks on staged/changed files')
      console.log('  pnpm check --all   # Run all checks on all files')
      console.log('  pnpm check --lint  # Run lint check only')
      console.log('  pnpm check --type  # Run TypeScript check only')
      process.exitCode = 0
      return
    }

    printHeader('Check Runner')

    let exitCode = 0
    const runLint = !values.type || values.lint
    const runType = !values.lint || values.type

    // Run lint check if requested.
    if (runLint) {
      log.step('Running lint check')
      const lintArgs = ['run', 'lint']
      if (values.all) {
        lintArgs.push('--all')
      } else if (values.staged) {
        lintArgs.push('--staged')
      }

      log.progress('Checking lint')
      exitCode = await runCommand('pnpm', lintArgs, { stdio: 'pipe' })

      if (exitCode !== 0) {
        log.failed('Lint check failed')
        // Re-run with output.
        await runCommand('pnpm', lintArgs)
        process.exitCode = exitCode
        return
      }
      log.done('Lint check passed')
    }

    // Run TypeScript check if requested and tsconfig exists.
    if (runType) {
      const tsconfigPath = path.join(rootPath, 'tsconfig.json')
      const tsconfigCheckPath = path.join(rootPath, '.config', 'tsconfig.check.json')
      const configPath = existsSync(tsconfigCheckPath) ? tsconfigCheckPath : (existsSync(tsconfigPath) ? tsconfigPath : null)

      if (configPath) {
        log.step('Running TypeScript check')
        const tsconfigArg = configPath === tsconfigPath ? [] : ['-p', configPath]

        log.progress('Checking TypeScript')
        exitCode = await runCommand('pnpm', [
          'exec',
          'tsgo',
          '--noEmit',
          ...tsconfigArg
        ], { stdio: 'pipe' })

        if (exitCode !== 0) {
          log.failed('TypeScript check failed')
          // Re-run with output.
          await runCommand('pnpm', [
            'exec',
            'tsgo',
            '--noEmit',
            ...tsconfigArg
          ])
          process.exitCode = exitCode
          return
        }
        log.done('TypeScript check passed')
      }
    }

    if (exitCode === 0) {
      log.success('All checks passed')
      printFooter('All checks passed!')
    }
  } catch (error) {
    log.error(`Check runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)