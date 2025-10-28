/**
 * @fileoverview Unified build script for Socket CLI.
 * Runs esbuild to build distribution files.
 *
 * Usage:
 *   node scripts/build.mjs [options]
 *
 * Options:
 *   --quiet      Suppress progress output
 *   --verbose    Show detailed output
 *   --sea        Build SEA binaries (delegates to build-sea.mjs)
 *   --no-minify  Build without minification for debugging
 */

import { spawn } from 'node:child_process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'

// Simple CLI helpers without registry dependencies.
const isQuiet = () => process.argv.includes('--quiet')
const isVerbose = () => process.argv.includes('--verbose')
const log = {
  info: msg => logger.log(`ℹ ${msg}`),
  step: msg => logger.log(`→ ${msg}`),
  success: msg => logger.log(`✓ ${msg}`),
  error: msg => logger.error(`✖ ${msg}`),
}
const printHeader = title =>
  logger.log(`\n${title}\n${'='.repeat(title.length)}\n`)
const printFooter = () => logger.log('')
const printSuccess = msg => logger.log(`\n✓ ${msg}\n`)
const printError = msg => logger.error(`\n✖ ${msg}\n`)

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const sea = process.argv.includes('--sea')
  const noMinify = process.argv.includes('--no-minify')

  // Pass --no-minify flag via environment variable to esbuild config.
  if (noMinify) {
    process.env.SOCKET_CLI_NO_MINIFY = '1'
  }

  // Delegate to build-sea.mjs if --sea flag is present.
  if (sea) {
    const seaArgs = process.argv.filter(arg => arg !== '--sea')
    const child = spawn(
      'node',
      ['scripts/build-sea.mjs', ...seaArgs.slice(2)],
      {
        stdio: 'inherit',
        env: process.env,
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
        name: 'Extract MiniLM Model',
        command: 'node',
        args: ['scripts/extract-minilm-model.mjs'],
      },
      {
        name: 'Extract ONNX Runtime',
        command: 'node',
        args: ['scripts/extract-onnx-runtime.mjs'],
      },
      {
        name: 'Extract Yoga WASM',
        command: 'node',
        args: ['scripts/extract-yoga-wasm.mjs'],
      },
      {
        name: 'esbuild Bundle',
        command: 'node',
        args: ['.config/esbuild.cli.build.mjs'],
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

      if (result.code !== 0) {
        if (!quiet) {
          log.error(`${name} failed (exit code: ${result.code})`)
        }
        // Always show output on failure.
        if (result.stdout) {
          logger.log(result.stdout)
        }
        if (result.stderr) {
          logger.error(result.stderr)
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
          logger.log(result.stdout)
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
      logger.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
