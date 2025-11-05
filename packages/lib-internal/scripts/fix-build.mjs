/**
 * @fileoverview Orchestrates all post-build fix scripts.
 * Runs package exports generation, path alias fixing, and CommonJS exports fixing in sequence.
 */

import { isQuiet } from '#socketsecurity/lib/argv/flags'
import { getDefaultLogger } from '#socketsecurity/lib/logger'
import { printFooter, printHeader } from '#socketsecurity/lib/stdio/header'

import { runSequence } from './utils/run-command.mjs'

const logger = getDefaultLogger()

async function main() {
  const verbose = process.argv.includes('--verbose')
  const quiet = isQuiet()

  if (!quiet) {
    printHeader('Fixing Build Output')
  }

  const fixArgs = []
  if (quiet) {
    fixArgs.push('--quiet')
  }
  if (verbose) {
    fixArgs.push('--verbose')
  }

  const exitCode = await runSequence([
    {
      args: ['scripts/generate-package-exports.mjs', ...fixArgs],
      command: 'node',
    },
    {
      args: ['scripts/fix-path-aliases.mjs', ...fixArgs],
      command: 'node',
    },
    {
      args: ['scripts/fix-commonjs-exports.mjs', ...fixArgs],
      command: 'node',
    },
  ])

  if (!quiet) {
    printFooter()
  }

  if (exitCode !== 0) {
    logger.error('Build fixing failed')
    process.exitCode = exitCode
  }
}

main().catch(error => {
  logger.error(`Build fixing failed: ${error.message || error}`)
  process.exitCode = 1
})
