/**
 * @fileoverview Unified build runner with flag-based configuration.
 * Orchestrates the complete build process with flexible options.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

import { printDivider, printFooter, printHeader, printHelpHeader } from './print.mjs'
import { runCommand, runSequence } from './utils/run-command.mjs'

// Simple inline logger.
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => process.stdout.write(`  ∴ ${msg}`),
  done: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  }
}

// Inline utilities.
const isQuiet = values => values.quiet || values.silent

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const rootPath = path.join(__dirname, '..')

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
 * Build SEA stub.
 */
async function buildStub(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    log.progress('Building SEA stub')
  }

  process.env['NODE_ENV'] = 'production'
  const exitCode = await runCommand(
    'pnpm',
    ['exec', 'rollup', '-c', '.config/rollup.sea.config.mjs'],
    {
      stdio: quiet ? 'pipe' : 'inherit'
    }
  )

  if (exitCode !== 0) {
    if (!quiet) {
      log.failed('SEA stub build failed')
    }
    return exitCode
  }

  if (!quiet) {
    log.done('SEA stub built')
  }

  return 0
}

/**
 * Build SEA binary using yao-pkg.
 */
async function buildSea(options = {}) {
  const {
    arch = process.arch,
    minify = false,  // Default to current platform
    platform = process.platform,  // Default to current architecture
    quiet = false
  } = options

  if (!quiet) {
    log.progress(`Building yao-pkg binary for ${platform}-${arch}`)
  }

  // Build the SEA using yao-pkg (which uses the custom Node.js with patches)
  const args = [path.join(rootPath, 'scripts', 'build', 'build-stub.mjs')]

  // Always pass platform and arch (using defaults if not specified)
  args.push(`--platform=${platform}`)
  args.push(`--arch=${arch}`)

  if (minify) {
    args.push('--minify')
  }

  if (quiet) {
    args.push('--quiet')
  }

  const exitCode = await runCommand('node', args, {
    stdio: quiet ? 'pipe' : 'inherit'
  })

  if (exitCode !== 0) {
    if (!quiet) {
      log.failed('yao-pkg binary build failed')
    }
    return exitCode
  }

  if (!quiet) {
    log.done('yao-pkg binary built')
  }

  return 0
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
        sea: {
          type: 'boolean',
          default: false,
        },
        stub: {
          type: 'boolean',
          default: false,
        },
        platform: {
          type: 'string',
        },
        arch: {
          type: 'string',
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
      console.log('  --sea        Build self-contained binary with yao-pkg')
      console.log('  --stub       Build SEA stub only (for Node.js native SEA)')
      console.log('  --platform   Platform for SEA build (darwin, linux, win32)')
      console.log('  --arch       Architecture for SEA build (x64, arm64)')
      console.log('  --watch      Watch mode for development')
      console.log('  --needed     Only build if dist files are missing')
      console.log('  --quiet, --silent  Suppress progress messages')
      console.log('  --verbose    Show detailed build output (including Rollup warnings)')
      console.log('\nExamples:')
      console.log('  pnpm build              # Full build (source + types)')
      console.log('  pnpm build --src        # Build source only')
      console.log('  pnpm build --types      # Build types only')
      console.log('  pnpm build --stub       # Build SEA stub only (for Node.js native SEA)')
      console.log('  pnpm build --sea        # Build self-contained binary with yao-pkg')
      console.log('  pnpm build --sea --platform=darwin --arch=arm64  # Build macOS ARM64 binary')
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
    // Build SEA binary
    else if (values.sea) {
      if (!quiet) {
        log.step('Building SEA binary')
      }
      exitCode = await buildSea({ quiet, verbose, platform: values.platform, arch: values.arch })
    }
    // Build SEA stub only
    else if (values.stub) {
      if (!quiet) {
        log.step('Building SEA stub only')
      }
      exitCode = await buildStub({ quiet, verbose })
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