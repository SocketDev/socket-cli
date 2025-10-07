/**
 * @fileoverview Affected test runner that runs only tests affected by changes.
 * Uses git utilities to detect changes and maps them to relevant test files.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import WIN32 from '@socketsecurity/registry/lib/constants/WIN32'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getTestsToRun } from './utils/affected-test-mapper.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const nodeModulesBinPath = path.join(rootPath, 'node_modules', '.bin')

async function main() {
  try {
    // Parse arguments
    const { positionals, values } = parseArgs({
      options: {
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
        coverage: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    const { all, coverage, force, staged } = values
    // Support --force as alias for --all for backwards compatibility
    const runAll = all || force

    // Build first if dist doesn't exist
    const distIndexPath = path.join(rootPath, 'dist', 'cli.js')
    if (!existsSync(distIndexPath)) {
      logger.info('Building project before tests...')
      const { execSync } = await import('node:child_process')
      execSync('pnpm run build:dist:src', {
        cwd: rootPath,
        stdio: 'inherit',
      })
    }

    // Get tests to run
    const testsToRun = getTestsToRun({ staged, all: runAll })

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
    if (coverage) {
      vitestArgs.push('--coverage')
    }

    // Add test patterns if not running all
    if (testsToRun === 'all') {
      logger.info('Running all tests')
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
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${process.env.CI ? 8192 : 4096}`.trim(),
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
