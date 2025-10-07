/**
 * @fileoverview Build script for the CLI.
 * Orchestrates the complete build process:
 * - Cleans dist directory
 * - Compiles source with Rollup
 * - Builds Ink components
 * - Generates TypeScript declarations
 *
 * Usage:
 *   node scripts/build.mjs [--src-only|--types-only|--ink-only]
 */

import { parseArgs } from 'node:util'

import { logger } from '@socketsecurity/registry/lib/logger'

import { runSequence } from './utils/run-command.mjs'

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        'src-only': { type: 'boolean', default: false },
        'types-only': { type: 'boolean', default: false },
      },
      strict: false,
    })

    const srcOnly = values['src-only']
    const typesOnly = values['types-only']

    if (typesOnly) {
      logger.log('Building TypeScript declarations only...')
      const exitCode = await runSequence([
        { args: ['run', 'clean:dist:types'], command: 'pnpm' },
        { args: ['--project', 'tsconfig.dts.json'], command: 'tsgo' },
      ])
      process.exitCode = exitCode
      return
    }

    if (srcOnly) {
      logger.log('Building source only...')
      const exitCode = await runSequence([
        { args: ['run', 'clean:dist'], command: 'pnpm' },
        {
          args: ['-c', '.config/rollup.dist.config.mjs'],
          command: 'rollup',
        },
      ])
      process.exitCode = exitCode
      return
    }

    // Build both src and types
    logger.log('Building CLI (source + types)...')

    // Build src
    const srcExitCode = await runSequence([
      { args: ['run', 'clean:dist'], command: 'pnpm' },
      {
        args: ['-c', '.config/rollup.dist.config.mjs'],
        command: 'rollup',
      },
    ])

    if (srcExitCode !== 0) {
      process.exitCode = srcExitCode
      return
    }

    // Build types
    const typesExitCode = await runSequence([
      { args: ['run', 'clean:dist:types'], command: 'pnpm' },
      { args: ['--project', 'tsconfig.dts.json'], command: 'tsgo' },
    ])

    process.exitCode = typesExitCode
  } catch (error) {
    logger.error('Build failed:', error.message)
    process.exitCode = 1
  }
}

main()
