/**
 * @fileoverview Clean script for the CLI.
 * Removes build artifacts, caches, and other generated files.
 *
 * Usage:
 *   node scripts/clean.mjs [options]
 *
 * Options:
 *   --cache           Clean cache directories only
 *   --dist            Clean dist directory only
 *   --dist-types      Clean dist/types only
 *   --node-modules    Clean node_modules
 *   --all             Clean everything (default)
 */

import { parseArgs } from 'node:util'

import { logger } from '@socketsecurity/registry/lib/logger'

import { runCommand } from './utils/run-command.mjs'

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        all: { type: 'boolean', default: false },
        cache: { type: 'boolean', default: false },
        dist: { type: 'boolean', default: false },
        'dist-types': { type: 'boolean', default: false },
        'node-modules': { type: 'boolean', default: false },
      },
      strict: false,
    })

    // If no specific option is provided, clean everything
    const cleanAll =
      values.all ||
      (!values.cache &&
        !values.dist &&
        !values['dist-types'] &&
        !values['node-modules'])

    const tasks = []

    if (cleanAll || values.cache) {
      tasks.push({ name: 'cache', pattern: '**/.cache' })
    }

    if (cleanAll || values.dist) {
      tasks.push({
        name: 'dist',
        pattern: 'dist **/*.tsbuildinfo',
      })
    }

    if (!cleanAll && values['dist-types']) {
      tasks.push({ name: 'dist/types', pattern: 'dist/types' })
    }

    if (values['node-modules']) {
      tasks.push({ name: 'node_modules', pattern: '**/node_modules' })
    }

    if (tasks.length === 0) {
      logger.log('Nothing to clean')
      return
    }

    logger.log('Cleaning...')
    let hadError = false

    for (const task of tasks) {
      logger.log(`  - ${task.name}`)
      // eslint-disable-next-line no-await-in-loop
      const exitCode = await runCommand('del-cli', [task.pattern], {
        stdio: 'pipe',
      })
      if (exitCode !== 0) {
        hadError = true
      }
    }

    if (hadError) {
      process.exitCode = 1
    } else {
      logger.log('Clean complete')
    }
  } catch (error) {
    logger.error('Clean failed:', error.message)
    process.exitCode = 1
  }
}

main().catch(console.error)
