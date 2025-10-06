/**
 * @fileoverview Lint fix script for the CLI.
 * Runs all linters in sequence with auto-fix enabled:
 * 1. oxlint - Fast Rust-based linter
 * 2. biome - Fast formatter
 * 3. eslint - Final linting pass
 *
 * Supports fixing specific directories with --dist or --external flags.
 *
 * Usage:
 *   node scripts/lint-fix.mjs [--dist|--external]
 */

import { parseArgs } from 'node:util'

import { logger } from '@socketsecurity/registry/lib/logger'

import { runCommandQuiet } from './utils/run-command.mjs'

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        dist: { type: 'boolean', default: false },
        external: { type: 'boolean', default: false },
      },
      strict: false,
    })

    const targetDir = values.dist
      ? './dist'
      : values.external
        ? './external'
        : '.'
    const targetName = values.dist
      ? 'dist'
      : values.external
        ? 'external'
        : 'all'

    logger.log(`Running linters with auto-fix (${targetName})...`)

    const silentFlag = values.dist ? '--silent' : '--quiet'

    const linters = [
      {
        args: [
          'oxlint',
          '-c=.config/oxlintrc.json',
          '--ignore-path=.oxlintignore',
          '--tsconfig=tsconfig.json',
          silentFlag,
          '--fix',
          targetDir,
        ],
        name: 'oxlint',
      },
      {
        args: ['biome', 'format', '--log-level=none', '--fix', targetDir],
        name: 'biome',
      },
    ]

    // Only add eslint for main directory
    if (!values.dist && !values.external) {
      linters.push({
        args: [
          'eslint',
          '--config',
          '.config/eslint.config.mjs',
          '--report-unused-disable-directives',
          '--fix',
          targetDir,
        ],
        name: 'eslint',
      })
    }

    let hadError = false

    for (const { args, name } of linters) {
      logger.log(`  - Running ${name}...`)
      // eslint-disable-next-line no-await-in-loop
      const result = await runCommandQuiet(args[0], args.slice(1))

      // These linters can exit with non-zero when they make fixes
      // So we don't treat that as an error
      if (result.exitCode !== 0) {
        // Log stderr only if there's actual error content
        if (result.stderr && result.stderr.trim().length > 0) {
          logger.error(`${name} errors:`, result.stderr)
          hadError = true
        }
      }
    }

    if (hadError) {
      process.exitCode = 1
    } else {
      logger.log('Lint fixes complete')
    }
  } catch (error) {
    logger.error('Lint fix failed:', error.message)
    process.exitCode = 1
  }
}

main()
