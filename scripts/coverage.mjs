/**
 * @fileoverview Coverage script for the CLI.
 * Collects both code coverage and type coverage.
 *
 * Usage:
 *   node scripts/coverage.mjs [--code-only|--type-only|--percent]
 */

import { parseArgs } from 'node:util'

import { logger } from '@socketsecurity/registry/lib/logger'

import { runSequence } from './utils/run-command.mjs'

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        'code-only': { type: 'boolean', default: false },
        percent: { type: 'boolean', default: false },
        'type-only': { type: 'boolean', default: false },
      },
      strict: false,
    })

    if (values.percent) {
      // Just get coverage percentage
      const exitCode = await runSequence([
        { args: ['scripts/get-coverage-percentage.mjs'], command: 'node' },
      ])
      process.exitCode = exitCode
      return
    }

    if (values['type-only']) {
      logger.log('Collecting type coverage...')
      const exitCode = await runSequence([
        { args: ['exec', 'type-coverage'], command: 'pnpm' },
      ])
      process.exitCode = exitCode
      return
    }

    if (values['code-only']) {
      logger.log('Collecting code coverage...')
      const exitCode = await runSequence([
        { args: ['run', 'pretest:unit'], command: 'pnpm' },
        {
          args: ['run', 'test:unit:coverage'],
          command: 'pnpm',
        },
      ])
      process.exitCode = exitCode
      return
    }

    // Collect both code and type coverage
    logger.log('Collecting coverage (code + type)...')

    const codeExitCode = await runSequence([
      { args: ['run', 'pretest:unit'], command: 'pnpm' },
      {
        args: ['run', 'test:unit:coverage'],
        command: 'pnpm',
      },
    ])

    if (codeExitCode !== 0) {
      process.exitCode = codeExitCode
      return
    }

    const typeExitCode = await runSequence([
      { args: ['exec', 'type-coverage'], command: 'pnpm' },
    ])

    process.exitCode = typeExitCode
  } catch (error) {
    logger.error('Coverage collection failed:', error.message)
    process.exitCode = 1
  }
}

main().catch(console.error)
