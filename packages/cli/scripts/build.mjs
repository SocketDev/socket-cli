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
 *   --prod       Build for production (includes compression)
 *   --force      Force rebuild (clean dist first)
 *   --watch      Watch mode for development
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(__dirname, '../../..')

// Node options for memory allocation.
const NODE_MEMORY_FLAGS = ['--max-old-space-size=8192']

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
  const watch = process.argv.includes('--watch')
  const force = process.argv.includes('--force')
  const prod = process.argv.includes('--prod')

  // Pass --force flag via environment variable.
  if (force) {
    process.env.SOCKET_CLI_FORCE_BUILD = '1'
  }

  // Delegate to watch mode.
  if (watch) {
    if (!quiet) {
      log.info('Starting watch mode...')
    }

    // First extract yoga WASM.
    const extractResult = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, 'scripts/extract-yoga-wasm.mjs'],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (extractResult.code !== 0) {
      process.exitCode = extractResult.code
      throw new Error(
        `WASM extraction failed with exit code ${extractResult.code}`,
      )
    }

    // Then start esbuild in watch mode.
    const watchResult = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, '.config/esbuild.cli.build.mjs', '--watch'],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (watchResult.code !== 0) {
      process.exitCode = watchResult.code
      throw new Error(`Watch mode failed with exit code ${watchResult.code}`)
    }
    return
  }

  // Delegate to build-sea.mjs if --sea flag is present.
  if (sea) {
    const seaArgs = process.argv.filter(arg => arg !== '--sea')
    const result = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, 'scripts/build-sea.mjs', ...seaArgs.slice(2)],
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

    // If force build, always clean first.
    const shouldClean = force

    const steps = [
      ...(shouldClean
        ? [
            {
              name: 'Clean Dist',
              command: 'pnpm',
              args: ['run', 'clean:dist'],
            },
          ]
        : []),
      // {
      //   name: 'Extract MiniLM Model',
      //   command: 'node',
      //   args: ['scripts/extract-minilm-model.mjs'],
      // },
      // {
      //   name: 'Extract ONNX Runtime',
      //   command: 'node',
      //   args: ['scripts/extract-onnx-runtime.mjs'],
      // },
      {
        name: 'Extract Yoga WASM',
        command: 'node',
        args: [...NODE_MEMORY_FLAGS, 'scripts/extract-yoga-wasm.mjs'],
      },
      {
        name: 'Build CLI Bundle',
        command: 'node',
        args: [...NODE_MEMORY_FLAGS, '.config/esbuild.cli.build.mjs'],
      },
      {
        name: 'Build Index Loader',
        command: 'node',
        args: [...NODE_MEMORY_FLAGS, '.config/esbuild.index.config.mjs'],
      },
      {
        name: 'Build Shadow NPM Inject',
        command: 'node',
        args: [...NODE_MEMORY_FLAGS, '.config/esbuild.inject.config.mjs'],
      },
      // Only compress for production builds (--prod).
      ...(prod
        ? [
            {
              name: 'Compress CLI',
              command: 'node',
              args: [...NODE_MEMORY_FLAGS, 'scripts/compress-cli.mjs'],
            },
          ]
        : []),
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

    // Copy files from repo root.
    if (!quiet && verbose) {
      log.info('Copying files from repo root...')
    }
    const filesToCopy = [
      'CHANGELOG.md',
      'LICENSE',
      'logo-dark.png',
      'logo-light.png',
    ]
    for (const file of filesToCopy) {
      await fs.cp(path.join(repoRoot, file), path.join(packageRoot, file))
    }
    if (!quiet && verbose) {
      log.success('Files copied from repo root')
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
