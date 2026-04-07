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
      const contents = await fs.readFile(filePath, 'utf-8')

      // Check if file contains the problematic pattern.
      if (contents.includes('node-gyp/bin/node-gyp.js')) {
        // Replace literal string with concatenated version.
        const fixed = contents.replace(
          /["']node-gyp\/bin\/node-gyp\.js["']/g,
          '"node-" + "gyp/bin/node-gyp.js"',
        )

        await fs.writeFile(filePath, fixed, 'utf-8')

        if (!quiet && verbose) {
          logger.info(
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
      logger.info('Starting watch mode...')
    }

    // Start esbuild in watch mode.
    const watchResult = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, '.config/esbuild.cli.mjs', '--watch'],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (!watchResult || watchResult.code !== 0) {
      process.exitCode = watchResult?.code ?? 1
      throw new Error(`Watch mode failed with exit code ${watchResult?.code ?? 1}`)
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
        logger.step('Phase 1: Cleaning...')
      }
      const result = await spawn('pnpm', ['run', 'clean:dist'], {
        shell: WIN32,
        stdio: 'inherit',
      })
      if (result.code !== 0) {
        if (!quiet) {
          logger.error(`Clean failed (exit code: ${result.code})`)
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }
      if (!quiet && verbose) {
        logger.success('Clean completed')
      }
    }

    // Phase 2: Generate packages and download assets in parallel.
    if (!quiet) {
      logger.step('Phase 2: Preparing build (parallel)...')
    }

    const parallelPrep = await Promise.allSettled([
      spawn('node', ['scripts/generate-packages.mjs'], {
        shell: WIN32,
        stdio: 'inherit',
      }).then(result => ({ name: 'Generate Packages', result })),
      spawn('node', [...NODE_MEMORY_FLAGS, 'scripts/download-assets.mjs'], {
        shell: WIN32,
        stdio: 'inherit',
      }).then(result => ({ name: 'Download Assets', result })),
    ])

    for (const settled of parallelPrep) {
      if (settled.status === 'rejected') {
        if (!quiet) {
          logger.error(`Parallel preparation failed: ${settled.reason}`)
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }

      const { name, result } = settled.value

      // Check for null spawn result.
      if (!result) {
        if (!quiet) {
          logger.error(`${name} failed to start`)
          printError('Build failed')
        }
        process.exitCode = 1
        return
      }

      if (result.code !== 0) {
        if (!quiet) {
          logger.error(`${name} failed (exit code: ${result.code})`)
          printError('Build failed')
        }
        process.exitCode = result.code ?? 1
        return
      }

      if (!quiet && verbose) {
        logger.success(`${name} completed`)
      }
    }

    // Phase 3: Build all variants.
    if (!quiet) {
      logger.step('Phase 3: Building variants...')
    }

    // Ensure dist directory exists before building variants.
    await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true })

    const buildResult = await spawn(
      'node',
      [...NODE_MEMORY_FLAGS, '.config/esbuild.build.mjs', 'all'],
      {
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (buildResult.code !== 0) {
      if (!quiet) {
        logger.error(`Build failed (exit code: ${buildResult.code})`)
        printError('Build failed')
      }
      process.exitCode = 1
      return
    }

    if (!quiet && verbose) {
      logger.success('Build completed')
    }

    // Phase 4: Post-processing (parallel).
    if (!quiet) {
      logger.step('Phase 4: Post-processing (parallel)...')
    }

    const postResults = await Promise.allSettled([
      // Copy CLI bundle to dist (required for dist/index.js to work).
      (async () => {
        copyFileSync('build/cli.js', 'dist/cli.js')
        if (!quiet && verbose) {
          logger.success('CLI bundle copied')
        }
      })(),

      // Fix node-gyp strings to prevent bundler issues.
      (async () => {
        await fixNodeGypStrings(path.join(packageRoot, 'build'), {
          quiet,
          verbose,
        })
        if (!quiet && verbose) {
          logger.success('Build output post-processed')
        }
      })(),

      // Copy CHANGELOG.md from repo root (LICENSE and logos are already in cli package).
      (async () => {
        await fs.cp(
          path.join(repoRoot, 'CHANGELOG.md'),
          path.join(packageRoot, 'CHANGELOG.md'),
        )
        if (!quiet && verbose) {
          logger.success('CHANGELOG.md copied from repo root')
        }
      })(),
    ])

    const postFailed = postResults.filter(r => r.status === 'rejected')
    if (postFailed.length > 0) {
      for (const r of postFailed) {
        logger.error(`Post-processing failed: ${r.reason?.message ?? r.reason}`)
      }
      throw new Error('Post-processing step(s) failed')
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
