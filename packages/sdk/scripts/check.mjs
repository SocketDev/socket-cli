#!/usr/bin/env node
/**
 * @fileoverview Check script for the SDK.
 * Runs all quality checks in parallel:
 * - TypeScript type checking
 * - ESLint
 *
 * Usage:
 *   node scripts/check.mjs
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printFooter, printHeader } from '@socketsecurity/lib/stdio/header'

import { getLocalPackageAliases } from './utils/get-local-package-aliases.mjs'
import { runParallel } from './utils/run-command.mjs'

// Initialize logger
const logger = getDefaultLogger()

// Determine which TypeScript config to use based on local package detection
const localPackageAliases = getLocalPackageAliases(process.cwd())
const hasLocalPackages = Object.keys(localPackageAliases).length > 0
const tsConfigPath = hasLocalPackages
  ? '.config/tsconfig.check.local.json'
  : '.config/tsconfig.check.json'

async function main() {
  try {
    printHeader('Check Runner')

    const checks = [
      {
        args: ['exec', 'tsgo', '--noEmit', '-p', tsConfigPath],
        command: 'pnpm',
      },
      {
        args: [
          'exec',
          'eslint',
          '--config',
          '.config/eslint.config.mjs',
          '--report-unused-disable-directives',
          '.',
        ],
        command: 'pnpm',
      },
      {
        args: ['scripts/validate-no-link-deps.mjs'],
        command: 'node',
      },
      {
        args: ['scripts/validate-bundle-deps.mjs'],
        command: 'node',
      },
      {
        args: ['scripts/validate-esbuild-minify.mjs'],
        command: 'node',
      },
      {
        args: ['scripts/validate-no-cdn-refs.mjs'],
        command: 'node',
      },
      {
        args: ['scripts/validate-markdown-filenames.mjs'],
        command: 'node',
      },
      {
        args: ['scripts/validate-file-size.mjs'],
        command: 'node',
      },
      {
        args: ['scripts/validate-file-count.mjs'],
        command: 'node',
      },
    ]

    const exitCodes = await runParallel(checks)
    const failed = exitCodes.some(code => code !== 0)

    if (failed) {
      logger.log('')
      logger.error('Some checks failed')
      process.exitCode = 1
    } else {
      logger.log('')
      logger.success('All checks passed')
      printFooter()
    }
  } catch (error) {
    logger.log('')
    logger.error(`Check failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
