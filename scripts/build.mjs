/**
 * @fileoverview Unified build runner with flag-based configuration.
 * Orchestrates the complete build process with flexible options.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

import { runCommand, runSequence } from './utils/run-command.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Simple clean logging without prefixes
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => {
    // Write progress message without newline for in-place updates
    process.stdout.write(`  ∴ ${msg}`)
  },
  done: msg => {
    // Clear current line and write success message
    // Carriage return + clear line
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    // Clear current line and write failure message
    // Carriage return + clear line
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  }
}

/**
 * Build source code with Rollup.
 */
async function buildSource(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    log.progress('Building source code')
  }

  const exitCode = await runSequence([
    { args: ['run', 'clean:dist'], command: 'pnpm' },
    {
      args: ['exec', 'rollup', '-c', '.config/rollup.dist.config.mjs'],
      command: 'pnpm',
    },
  ])

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
  const { quiet = false } = options

  if (!quiet) {
    log.progress('Building TypeScript declarations')
  }

  const exitCode = await runSequence([
    { args: ['run', 'clean:dist:types'], command: 'pnpm' },
    {
      args: ['exec', 'tsgo', '--project', 'tsconfig.dts.json'],
      command: 'pnpm',
    },
  ])

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
  const { quiet = false } = options

  if (!quiet) {
    log.step('Starting watch mode')
    log.substep('Watching for file changes...')
  }

  const exitCode = await runCommand(
    'pnpm',
    ['exec', 'rollup', '-c', '.config/rollup.dist.config.mjs', '--watch'],
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
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Socket PackageURL Build Runner')
      console.log('\nUsage: pnpm build [options]')
      console.log('\nOptions:')
      console.log('  --help       Show this help message')
      console.log('  --src        Build source code only')
      console.log('  --types      Build TypeScript declarations only')
      console.log('  --watch      Watch mode for development')
      console.log('  --needed     Only build if dist files are missing')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('\nExamples:')
      console.log('  pnpm build              # Full build (source + types)')
      console.log('  pnpm build --src        # Build source only')
      console.log('  pnpm build --types      # Build types only')
      console.log('  pnpm build --watch      # Watch mode')
      console.log('  pnpm build --needed     # Build only if needed')
      process.exitCode = 0
      return
    }

    // Handle aliases
    const quiet = values.quiet || values.silent

    // Check if build is needed
    if (values.needed && !isBuildNeeded()) {
      if (!quiet) {
        log.info('Build artifacts exist, skipping build')
      }
      process.exitCode = 0
      return
    }

    if (!quiet) {
      console.log('═══════════════════════════════════════════════════════')
      console.log('  Socket PackageURL Build Runner')
      console.log('═══════════════════════════════════════════════════════')
    }

    let exitCode = 0

    // Handle watch mode
    if (values.watch) {
      exitCode = await watchBuild({ quiet })
    }
    // Build types only
    else if (values.types && !values.src) {
      if (!quiet) {
        log.step('Building TypeScript declarations only')
      }
      exitCode = await buildTypes({ quiet })
    }
    // Build source only
    else if (values.src && !values.types) {
      if (!quiet) {
        log.step('Building source only')
      }
      exitCode = await buildSource({ quiet })
    }
    // Build everything (default)
    else {
      if (!quiet) {
        log.step('Building package (source + types)')
      }

      // Build source first
      exitCode = await buildSource({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          log.error('Build failed')
        }
        process.exitCode = exitCode
        return
      }

      // Then build types
      exitCode = await buildTypes({ quiet })
    }

    if (exitCode !== 0) {
      if (!quiet) {
        log.error('Build failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        console.log('\n═══════════════════════════════════════════════════════')
        log.success('Build completed successfully!')
        console.log('═══════════════════════════════════════════════════════')
      }
    }
  } catch (error) {
    log.error(`Build runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)