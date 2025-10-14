/**
 * @fileoverview Unified build script for Socket CLI.
 * Runs rollup to build distribution files and types.
 *
 * Usage:
 *   node scripts/build.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 *   --src-only Build source files only (skip types)
 *   --types-only Build type definitions only (skip source)
 */

import { runCommand, runCommandQuiet } from './utils/run-command.mjs'

// Simple CLI helpers without registry dependencies.
const isQuiet = () => process.argv.includes('--quiet')
const isVerbose = () => process.argv.includes('--verbose')
const log = {
  info: msg => console.log(`ℹ ${msg}`),
  step: msg => console.log(`→ ${msg}`),
  success: msg => console.log(`✓ ${msg}`),
  error: msg => console.error(`✖ ${msg}`),
}
const printHeader = title => console.log(`\n━━━ ${title} ━━━\n`)
const printFooter = () => console.log('')
const printSuccess = msg => console.log(`\n✓ ${msg}\n`)
const printError = msg => console.error(`\n✖ ${msg}\n`)

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const srcOnly = process.argv.includes('--src-only')
  const typesOnly = process.argv.includes('--types-only')

  try {
    if (!quiet) {
      printHeader('Building Socket CLI')
    }

    const steps = []

    // Build dist files with rollup.
    if (!typesOnly) {
      steps.push({
        name: 'Clean Dist',
        command: 'pnpm',
        args: ['run', 'clean:dist'],
      })
      steps.push({
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
      })
    }

    // Build type definitions with tsgo.
    if (!srcOnly) {
      steps.push({
        name: 'Type Definitions',
        command: 'pnpm',
        args: ['run', 'clean:dist:types'],
      })
      steps.push({
        name: 'TypeScript Declarations',
        command: 'tsgo',
        args: ['--project', 'tsconfig.dts.json'],
      })
    }

    if (steps.length === 0) {
      if (!quiet) {
        log.info('No build steps to run')
        printFooter()
      }
      return
    }

    // Run build steps sequentially.
    if (!quiet) {
      log.step(
        `Running ${steps.length} build step${steps.length > 1 ? 's' : ''}...`,
      )
    }

    for (const { name, command, args } of steps) {
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
