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

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

// Simple CLI helpers without registry dependencies.
const isQuiet = () => process.argv.includes('--quiet')
const isVerbose = () => process.argv.includes('--verbose')
const log = {
  info: msg => logger.info(msg),
  step: msg => logger.step(msg),
  success: msg => logger.success(msg),
  error: msg => logger.error(msg),
}
const printHeader = title => {
  logger.log('')
  logger.log(title)
  logger.log('='.repeat(title.length))
  logger.log('')
}
const printFooter = () => logger.log('')
const printSuccess = msg => {
  logger.log('')
  logger.success(msg)
  logger.log('')
}
const printError = msg => {
  logger.log('')
  logger.error(msg)
  logger.log('')
}

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
    const result = await spawn(
      'node',
      ['scripts/build-sea.mjs', ...seaArgs.slice(2)],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (result.code !== 0) {
      process.exitCode = result.code
      throw new Error(`SEA build failed with exit code ${result.code}`)
    }
    return
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

      const result = await spawn(command, args, {
        shell: WIN32,
        stdio: 'inherit',
      })

      if (result.code !== 0) {
        if (!quiet) {
          log.error(`${name} failed (exit code: ${result.code})`)
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }

      if (!quiet && verbose) {
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
