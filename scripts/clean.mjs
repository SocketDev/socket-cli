/**
 * @fileoverview Standardized clean runner that removes build artifacts and caches.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { deleteAsync } from 'del'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Simple inline logger.
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
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

function printHeader(title) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'─'.repeat(60)}`)
}

function printFooter(message) {
  console.log(`\n${'─'.repeat(60)}`)
  if (message) {
    console.log(`  ${colors.green('✓')} ${message}`)
  }
}

/**
 * Clean specific directories.
 */
async function cleanDirectories(patterns) {
  for (const { name, paths } of patterns) {
    log.progress(`Cleaning ${name}`)

    let hasError = false
    for (const targetPath of paths) {
      const fullPath = path.join(rootPath, targetPath)
      if (existsSync(fullPath)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await deleteAsync(fullPath, { force: true })
        } catch (error) {
          hasError = true
          log.failed(`Failed to clean ${name}: ${error.message}`)
          break
        }
      }
    }

    if (!hasError) {
      log.done(`Cleaned ${name}`)
    }
  }
}

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        cache: {
          type: 'boolean',
          default: false,
        },
        coverage: {
          type: 'boolean',
          default: false,
        },
        dist: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        modules: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm clean [options]')
      console.log('\nOptions:')
      console.log('  --help       Show this help message')
      console.log('  --all        Clean everything (default if no flags)')
      console.log('  --cache      Clean cache directories')
      console.log('  --coverage   Clean coverage reports')
      console.log('  --dist       Clean build output')
      console.log('  --types      Clean TypeScript declarations only')
      console.log('  --modules    Clean node_modules')
      console.log('\nExamples:')
      console.log('  pnpm clean                      # Clean everything except node_modules')
      console.log('  pnpm clean --dist               # Clean build output only')
      console.log('  pnpm clean --cache --coverage   # Clean cache and coverage')
      console.log('  pnpm clean --all --modules      # Clean everything including node_modules')
      process.exitCode = 0
      return
    }

    // Determine what to clean.
    const cleanAll = values.all ||
      (!values.cache && !values.coverage && !values.dist && !values.types && !values.modules)

    const tasks = []

    // Detect project structure.
    const hasRegistry = existsSync(path.join(rootPath, 'registry'))

    // Build task list.
    if (cleanAll || values.cache) {
      tasks.push({
        name: 'cache',
        paths: [
          '.cache',
          hasRegistry ? 'registry/.cache' : null,
          '.config/.cache'
        ].filter(Boolean)
      })
    }

    if (cleanAll || values.coverage) {
      tasks.push({
        name: 'coverage',
        paths: [
          'coverage',
          hasRegistry ? 'registry/coverage' : null
        ].filter(Boolean)
      })
    }

    if (cleanAll || values.dist) {
      const distPaths = [
        'dist',
        hasRegistry ? 'registry/dist' : null
      ].filter(Boolean)

      tasks.push({
        name: 'dist',
        paths: distPaths
      })

      // Also clean tsbuildinfo files.
      tasks.push({
        name: 'tsbuildinfo',
        paths: [
          'tsconfig.tsbuildinfo',
          'tsconfig.dts.tsbuildinfo',
          hasRegistry ? 'registry/tsconfig.tsbuildinfo' : null,
          hasRegistry ? 'registry/.cache/tsconfig.dts.tsbuildinfo' : null,
          '.config/tsconfig.dts.tsbuildinfo'
        ].filter(Boolean)
      })
    } else if (values.types) {
      tasks.push({
        name: 'dist/types',
        paths: [
          'dist/types',
          hasRegistry ? 'registry/dist/types' : null
        ].filter(Boolean)
      })
    }

    if (values.modules) {
      tasks.push({
        name: 'node_modules',
        paths: ['node_modules']
      })
    }

    // Check if there's anything to clean.
    if (tasks.length === 0) {
      log.info('Nothing to clean')
      process.exitCode = 0
      return
    }

    printHeader('Clean Runner')
    log.step('Cleaning project directories')

    // Clean directories.
    await cleanDirectories(tasks)

    printFooter('Clean completed successfully!')
    process.exitCode = 0
  } catch (error) {
    log.error(`Clean runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)