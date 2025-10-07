/**
 * @fileoverview Check script for the CLI.
 * Runs all quality checks:
 * 1. Auto-fix linting issues
 * 2. ESLint check
 * 3. TypeScript type check
 *
 * Usage:
 *   node scripts/check.mjs
 */

import { logger } from '@socketsecurity/registry/lib/logger'

import { runSequence } from './utils/run-command.mjs'

async function main() {
  try {
    logger.log('Running checks...')

    const exitCode = await runSequence([
      { args: ['run', 'fix'], command: 'pnpm' },
      {
        args: [
          '--config',
          '.config/eslint.config.mjs',
          '--report-unused-disable-directives',
          '.',
        ],
        command: 'eslint',
      },
      { args: ['--noEmit'], command: 'tsgo' },
    ])

    if (exitCode !== 0) {
      logger.error('Some checks failed')
      process.exitCode = exitCode
    } else {
      logger.log('All checks passed')
    }
  } catch (error) {
    logger.error('Check failed:', error.message)
    process.exitCode = 1
  }
}

main().catch(console.error)
