/**
 * Build script for Socket CLI.
 * Options: --quiet, --verbose, --prod, --force, --watch
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

/**
 * Post-process bundled files to break node-gyp require.resolve strings.
 * This prevents esbuild from trying to bundle node-gyp during the build.
 *
 * @param {string} dir - Directory to process
 * @param {object} options - Options
 * @param {boolean} options.quiet - Suppress output
 * @param {boolean} options.verbose - Show detailed output
 */
async function fixNodeGypStrings(dir, options = {}) {
  const { quiet = false, verbose = false } = options

  // Find all .js files in build directory.
  const files = await fs.readdir(dir, { withFileTypes: true })

  for (const file of files) {
    const filePath = path.join(dir, file.name)

    if (file.isDirectory()) {
      // Recursively process subdirectories.
      await fixNodeGypStrings(filePath, options)
    } else if (file.name.endsWith('.js')) {
      // Read file contents.
      const contents = await fs.readFile(filePath, 'utf8')

      // Check if file contains the problematic pattern.
      if (contents.includes('node-gyp/bin/node-gyp.js')) {
        // Replace literal string with concatenated version.
        const fixed = contents.replace(
          /["']node-gyp\/bin\/node-gyp\.js["']/g,
          '"node-" + "gyp/bin/node-gyp.js"',
        )

        await fs.writeFile(filePath, fixed, 'utf8')

        if (!quiet && verbose) {
          log.info(
            `Fixed node-gyp string in ${path.relative(packageRoot, filePath)}`,
          )
        }
      }
    }
  }
}

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
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

    // Post-process: Fix node-gyp strings to prevent bundler issues.
    if (!quiet && verbose) {
      log.info('Post-processing build output...')
    }
    await fixNodeGypStrings(path.join(packageRoot, 'build'), { quiet, verbose })
    if (!quiet && verbose) {
      log.success('Build output post-processed')
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
