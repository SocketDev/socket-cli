/**
 * @fileoverview Unified build script for Socket CLI.
 * Runs rollup to build distribution files.
 *
 * Usage:
 *   node scripts/build.mjs [options]
 *
 * Options:
 *   --quiet      Suppress progress output
 *   --verbose    Show detailed output
 *   --sea        Build SEA binaries (delegates to build-sea.mjs)
 */

import { spawn } from 'node:child_process'

import { runCommandQuiet } from './utils/run-command.mjs'

// Simple CLI helpers without registry dependencies.
const isQuiet = () => process.argv.includes('--quiet')
const isVerbose = () => process.argv.includes('--verbose')
const log = {
  info: msg => console.log(`ℹ ${msg}`),
  step: msg => console.log(`→ ${msg}`),
  success: msg => console.log(`✓ ${msg}`),
  error: msg => console.error(`✖ ${msg}`),
}
const printHeader = title =>
  console.log(`\n${title}\n${'='.repeat(title.length)}\n`)
const printFooter = () => console.log('')
const printSuccess = msg => console.log(`\n✓ ${msg}\n`)
const printError = msg => console.error(`\n✖ ${msg}\n`)

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const sea = process.argv.includes('--sea')

  // Delegate to build-sea.mjs if --sea flag is present.
  if (sea) {
    const seaArgs = process.argv.filter(arg => arg !== '--sea')
    const child = spawn(
      'node',
      ['scripts/build-sea.mjs', ...seaArgs.slice(2)],
      {
        stdio: 'inherit',
      },
    )
    return new Promise((resolve, reject) => {
      child.on('exit', code => {
        if (code === 0) {
          resolve()
        } else {
          process.exitCode = code ?? 1
          reject(new Error(`SEA build failed with exit code ${code}`))
        }
      })
      child.on('error', reject)
    })
  }

  try {
    if (!quiet) {
      printHeader('Build Runner')
    }

    const steps = [
      {
        name: 'Clean Dist',
        command: 'pnpm',
        args: ['run', 'clean:dist'],
      },
      {
        name: 'Rollup Bundle',
        command: 'dotenvx',
        args: [
          '-q',
          'run',
          '-f',
          '.env.local',
          '--',
          'rollup',
          '-c',
          '.config/rollup.cli-js.config.mjs',
        ],
      },
    ]

    // Run build steps sequentially.
    if (!quiet) {
      log.step(
        `Running ${steps.length} build step${steps.length > 1 ? 's' : ''}...`,
      )
    }

    for (const { args, command, name } of steps) {
      if (verbose && !quiet) {
        log.info(`Running: ${command} ${args.join(' ')}`)
      }

      // Always use runCommandQuiet to capture output for error reporting.
      const result = await runCommandQuiet(command, args)

      if (result.exitCode !== 0) {
        if (!quiet) {
          log.error(`${name} failed (exit code: ${result.exitCode})`)
        }
        // Always show output on failure.
        if (result.stdout) {
          console.log(result.stdout)
        }
        if (result.stderr) {
          console.error(result.stderr)
        }
        if (!quiet) {
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }

      // Show output in verbose mode.
      if (!quiet && verbose) {
        if (result.stdout) {
          console.log(result.stdout)
        }
        log.success(`${name} completed`)
      }
    }

    if (!quiet) {
      printSuccess('Build completed')
      printFooter()
    }
  } catch (error) {
    if (!quiet) {
      printError(`Build failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
