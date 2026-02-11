/**
 * Build script for Socket CLI.
 * Options: --quiet, --verbose, --force, --watch
 */

import { copyFileSync, promises as fs } from 'node:fs'
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

  // Pass --force flag via environment variable.
  if (force) {
    process.env.SOCKET_CLI_FORCE_BUILD = '1'
  }

  // Delegate to watch mode.
  if (watch) {
    if (!quiet) {
      log.info('Starting watch mode...')
    }

    // First download yoga WASM (only needed asset for CLI bundle).
    const extractResult = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, 'scripts/download-assets.mjs', 'yoga'],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (!extractResult) {
      process.exitCode = 1
      throw new Error('Failed to start asset download')
    }

    if (extractResult.code !== 0) {
      process.exitCode = extractResult.code ?? 1
      throw new Error(
        `Asset download failed with exit code ${extractResult.code ?? 'unknown'}`,
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

    // Phase 1: Clean (if needed).
    if (shouldClean) {
      if (!quiet) {
        log.step('Phase 1: Cleaning...')
      }
      const result = await spawn('pnpm', ['run', 'clean:dist'], {
        shell: WIN32,
        stdio: 'inherit',
      })
      if (result.code !== 0) {
        if (!quiet) {
          log.error(`Clean failed (exit code: ${result.code})`)
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }
      if (!quiet && verbose) {
        log.success('Clean completed')
      }
    }

    // Phase 2: Generate packages and download assets in parallel.
    if (!quiet) {
      log.step('Phase 2: Preparing build (parallel)...')
    }

    const parallelPrep = await Promise.all([
      spawn('node', ['scripts/generate-packages.mjs'], {
        shell: WIN32,
        stdio: 'inherit',
      }),
      spawn(
        'node',
        [...NODE_MEMORY_FLAGS, 'scripts/download-assets.mjs', '--parallel'],
        {
          shell: WIN32,
          stdio: 'inherit',
        },
      ),
    ])

    for (const [index, result] of parallelPrep.entries()) {
      const stepName = index === 0 ? 'Generate Packages' : 'Download Assets'

      // Check for null spawn result.
      if (!result) {
        if (!quiet) {
          log.error(`${stepName} failed to start`)
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }

      if (result.code !== 0) {
        if (!quiet) {
          log.error(`${stepName} failed (exit code: ${result.code})`)
          printError('Build failed')
        }
        process.exitCode = result.code ?? 1
        return
      }

      if (!quiet && verbose) {
        log.success(`${stepName} completed`)
      }
    }

    // Phase 3: Build all variants.
    if (!quiet) {
      log.step('Phase 3: Building variants...')
    }

    // Ensure dist directory exists before building variants.
    await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true })

    const buildResult = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, '.config/esbuild.config.mjs', 'all'],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (buildResult.code !== 0) {
      if (!quiet) {
        log.error(`Build failed (exit code: ${buildResult.code})`)
        printError('Build failed')
      }
      process.exitCode = 1
      return
    }

    if (!quiet && verbose) {
      log.success('Build completed')
    }

    // Phase 4: Post-processing (parallel).
    if (!quiet) {
      log.step('Phase 4: Post-processing (parallel)...')
    }

    await Promise.all([
      // Copy CLI bundle to dist (required for dist/index.js to work).
      (async () => {
        copyFileSync('build/cli.js', 'dist/cli.js')
        if (!quiet && verbose) {
          log.success('CLI bundle copied')
        }
      })(),

      // Fix node-gyp strings to prevent bundler issues.
      (async () => {
        await fixNodeGypStrings(path.join(packageRoot, 'build'), {
          quiet,
          verbose,
        })
        if (!quiet && verbose) {
          log.success('Build output post-processed')
        }
      })(),

      // Copy files from repo root.
      (async () => {
        const filesToCopy = [
          'CHANGELOG.md',
          'LICENSE',
          'logo-dark.png',
          'logo-light.png',
        ]
        await Promise.all(
          filesToCopy.map(file =>
            fs.cp(path.join(repoRoot, file), path.join(packageRoot, file)),
          ),
        )
        if (!quiet && verbose) {
          log.success('Files copied from repo root')
        }
      })(),
    ])

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
