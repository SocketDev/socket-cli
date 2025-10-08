/**
 * @fileoverview Changed test runner that runs only tests affected by changes.
 * Uses git utilities to detect changes and maps them to relevant test files.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import WIN32 from '@socketsecurity/registry/lib/constants/WIN32'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getTestsToRun } from './utils/changed-test-mapper.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const nodeModulesBinPath = path.join(rootPath, 'node_modules', '.bin')

async function main() {
  try {
    // Parse arguments
    const { positionals, values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        force: {
          type: 'boolean',
          default: false,
        },
        cover: {
          type: 'boolean',
          default: false,
        },
        coverage: {
          type: 'boolean',
          default: false,
        },
        update: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      logger.info('Changed Test Runner')
      logger.info('\nUsage: node scripts/test-changed.mjs [options]')
      logger.info('\nOptions:')
      logger.info('  --help              Show this help message')
      logger.info('  --all, --force      Run all tests regardless of changes')
      logger.info('  --staged            Run tests affected by staged changes')
      logger.info('  --cover, --coverage Run tests with code coverage')
      logger.info('  --update            Update test snapshots')
      logger.info('\nExamples:')
      logger.info('  node scripts/test-changed.mjs          # Run changed tests')
      logger.info('  node scripts/test-changed.mjs --staged # Run tests for staged changes')
      logger.info('  node scripts/test-changed.mjs --all    # Force run all tests')
      process.exitCode = 0
      return
    }

    const { all, cover, coverage, force, staged, update } = values
    // Support aliases
    const runAll = all || force
    const withCoverage = cover || coverage

    // Build first if dist doesn't exist
    const distIndexPath = path.join(rootPath, 'dist', 'index.js')
    if (!existsSync(distIndexPath)) {
      logger.info('Building project before tests...')
      const { execSync } = await import('node:child_process')
      execSync('pnpm run build', {
        cwd: rootPath,
        stdio: 'inherit',
      })
    }

    // Get tests to run
    const testInfo = getTestsToRun({ staged, all: runAll })
    const { reason, tests: testsToRun } = testInfo

    // No tests needed
    if (testsToRun === null) {
      logger.info('No relevant changes detected, skipping tests')
      return
    }

    // Prepare vitest command
    const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
    const vitestPath = path.join(nodeModulesBinPath, vitestCmd)

    const vitestArgs = ['--config', '.config/vitest.config.mts', 'run']

    // Add coverage if requested
    if (withCoverage) {
      vitestArgs.push('--coverage')
    }

    // Add update if requested
    if (update) {
      vitestArgs.push('--update')
    }

    // Add test patterns if not running all
    if (testsToRun === 'all') {
      const reasonText = reason ? ` (${reason})` : ''
      logger.info(`Running all tests${reasonText}`)
    } else {
      logger.info(`Running affected tests: ${testsToRun.join(', ')}`)
      vitestArgs.push(...testsToRun)
    }

    // Add any additional arguments
    if (positionals.length > 0) {
      vitestArgs.push(...positionals)
    }

    const spawnOptions = {
      cwd: rootPath,
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${process.env.CI ? 8192 : 4096}`.trim(),
      },
      stdio: 'inherit',
    }

    const child = spawn(vitestPath, vitestArgs, spawnOptions)

    child.on('exit', code => {
      process.exitCode = code || 0
    })
  } catch (e) {
    logger.error('Error running tests:', e.message)
    process.exitCode = 1
  }
}

main().catch(console.error)
