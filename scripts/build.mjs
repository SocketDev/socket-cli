/**
 * @fileoverview Unified build runner with flag-based configuration.
 * Orchestrates the complete build process with flexible options.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import {
  getRootPath,
  isQuiet,
  log,
  printFooter,
  printHeader,
  printHelpHeader
} from './utils/common.mjs'
import { runCommand, runSequence } from './utils/run-command.mjs'

const rootPath = getRootPath(import.meta.url)

/**
 * Build source code with Rollup.
 */
async function buildSource(options = {}) {
  const { quiet = false, skipClean = false, verbose = false } = options

  if (!quiet) {
    log.progress('Building source code')
  }

  const commands = []

  if (!skipClean) {
    commands.push({ args: ['run', 'clean', '--dist', '--quiet'], command: 'pnpm' })
  }

  const rollupArgs = ['exec', 'rollup', '-c', '.config/rollup.dist.config.mjs']
  // Suppress Rollup warnings by default unless in verbose mode
  if (!verbose) {
    rollupArgs.push('--silent')
  }

  commands.push({
    args: rollupArgs,
    command: 'pnpm',
  })

  const exitCode = await runSequence(commands)

  if (exitCode !== 0) {
    if (!quiet) {
      log.failed('Source build failed')
    }
    return exitCode
  }

  if (!quiet) {
    log.done('Source build complete')
  }

  return 0
}

/**
 * Build TypeScript declarations.
 */
async function buildTypes(options = {}) {
  const { quiet = false, skipClean = false } = options

  if (!quiet) {
    log.progress('Building TypeScript declarations')
  }

  const commands = []

  if (!skipClean) {
    commands.push({ args: ['run', 'clean', '--types', '--quiet'], command: 'pnpm' })
  }

  commands.push({
    args: ['exec', 'tsgo', '--project', 'tsconfig.dts.json'],
    command: 'pnpm',
  })

  const exitCode = await runSequence(commands)

  if (exitCode !== 0) {
    if (!quiet) {
      log.failed('Type declarations build failed')
    }
    return exitCode
  }

  if (!quiet) {
    log.done('Type declarations built')
  }

  return 0
}

/**
 * Watch mode for development.
 */
async function watchBuild(options = {}) {
  const { quiet = false, verbose = false } = options

  if (!quiet) {
    log.step('Starting watch mode')
    log.substep('Watching for file changes...')
  }

  const rollupArgs = ['exec', 'rollup', '-c', '.config/rollup.dist.config.mjs', '--watch']
  // Suppress Rollup warnings by default unless in verbose mode
  if (!verbose) {
    rollupArgs.push('--silent')
  }

  const exitCode = await runCommand(
    'pnpm',
    rollupArgs,
    {
      stdio: 'inherit'
    }
  )

  return exitCode
}

/**
 * Check if build is needed.
 */
function isBuildNeeded() {
  const distPath = path.join(rootPath, 'dist', 'index.js')
  const distTypesPath = path.join(rootPath, 'dist', 'types', 'index.d.ts')

  return !existsSync(distPath) || !existsSync(distTypesPath)
}

async function main() {
  try {
    // Parse arguments
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        src: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        watch: {
          type: 'boolean',
          default: false,
        },
        needed: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        verbose: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      printHelpHeader('Build Runner')
      console.log('\nUsage: pnpm build [options]')
      console.log('\nOptions:')
      console.log('  --help       Show this help message')
      console.log('  --src        Build source code only')
      console.log('  --types      Build TypeScript declarations only')
      console.log('  --watch      Watch mode for development')
      console.log('  --needed     Only build if dist files are missing')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('  --verbose    Show detailed build output (including Rollup warnings)')
      console.log('\nExamples:')
      console.log('  pnpm build              # Full build (source + types)')
      console.log('  pnpm build --src        # Build source only')
      console.log('  pnpm build --types      # Build types only')
      console.log('  pnpm build --watch      # Watch mode')
      console.log('  pnpm build --needed     # Build only if needed')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)
    const verbose = values.verbose

    // Check if build is needed
    if (values.needed && !isBuildNeeded()) {
      if (!quiet) {
        log.info('Build artifacts exist, skipping build')
      }
      process.exitCode = 0
      return
    }

    if (!quiet) {
      printHeader('Build Runner')
    }

    let exitCode = 0

    // Handle watch mode
    if (values.watch) {
      exitCode = await watchBuild({ quiet, verbose })
    }
    // Build types only
    else if (values.types && !values.src) {
      if (!quiet) {
        log.step('Building TypeScript declarations only')
      }
      exitCode = await buildTypes({ quiet, verbose })
    }
    // Build source only
    else if (values.src && !values.types) {
      if (!quiet) {
        log.step('Building source only')
      }
      exitCode = await buildSource({ quiet, verbose })
    }
    // Build everything (default)
    else {
      if (!quiet) {
        log.step('Building package (source + types)')
      }

      // Clean all directories first (once)
      if (!quiet) {
        log.progress('Cleaning build directories')
      }
      exitCode = await runSequence([
        { args: ['run', 'clean', '--dist', '--types', '--quiet'], command: 'pnpm' }
      ])
      if (exitCode !== 0) {
        if (!quiet) {
          log.failed('Clean failed')
        }
        process.exitCode = exitCode
        return
      }

      // Run source and types builds in parallel
      const buildPromises = [
        buildSource({ quiet, verbose, skipClean: true }),
        buildTypes({ quiet, verbose, skipClean: true })
      ]

      const results = await Promise.all(buildPromises)
      exitCode = results.find(code => code !== 0) || 0
    }

    if (exitCode !== 0) {
      if (!quiet) {
        log.error('Build failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        printFooter('Build completed successfully!')
      }
    }
  } catch (error) {
    log.error(`Build runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)