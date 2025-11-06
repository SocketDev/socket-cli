/**
 * @fileoverview Check script for the lib.
 * Runs all quality checks in parallel:
 * - Biome (linting)
 * - TypeScript type checking
 *
 * Usage:
 *   node scripts/check.mjs
 */

import { getDefaultLogger } from '#socketsecurity/lib/logger'
import { printFooter, printHeader } from '#socketsecurity/lib/stdio/header'

import { runParallel } from './utils/run-command.mjs'

const logger = getDefaultLogger()

async function main() {
  try {
    printHeader('Code Checks')

    const checks = [
      {
        args: ['exec', 'biome', 'check', '.'],
        command: 'pnpm',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['exec', 'tsgo', '--noEmit'],
        command: 'pnpm',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-no-link-deps.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-no-extraneous-dependencies.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-esbuild-minify.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-no-cdn-refs.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-markdown-filenames.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-file-size.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
      {
        args: ['scripts/validate-file-count.mjs'],
        command: 'node',
        options: {
          ...(process.platform === 'win32' && { shell: true }),
        },
      },
    ]

    const exitCodes = await runParallel(checks)
    const failed = exitCodes.some(code => code !== 0)

    if (failed) {
      logger.error('Some checks failed')
      process.exitCode = 1
    } else {
      logger.success('All checks passed')
      printFooter()
    }
  } catch (error) {
    logger.error(`Check failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
