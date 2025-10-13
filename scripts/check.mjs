#!/usr/bin/env node
/**
 * @fileoverview Unified check script with registry utilities.
 */

import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createSectionHeader } from '@socketsecurity/registry/lib/stdio/header'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isQuiet } from '@socketsecurity/registry/lib/argv/flags'
import { spinner } from '@socketsecurity/registry/lib/spinner'
import { runCommandQuiet } from './utils/run-command.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
      },
      strict: false,
    })

    if (values.help) {
      console.log('Check Script')
      console.log('\nUsage: pnpm check [options]')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --quiet, --silent  Minimal output')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      console.log(createSectionHeader('Running Checks'))
      console.log()
    }

    // Run ESLint and TypeScript checks in parallel
    const checks = [
      {
        name: 'ESLint',
        command: 'pnpm',
        args: [
          'exec',
          'eslint',
          '--config',
          '.config/eslint.config.mjs',
          '--report-unused-disable-directives',
          '.',
        ],
      },
      {
        name: 'TypeScript',
        command: 'pnpm',
        args: ['exec', 'tsgo', '--noEmit'],
      },
    ]

    // Show progress for each check
    if (!quiet) {
      spinner.start('Running ESLint and TypeScript checks...')
    }

    const results = await Promise.all(
      checks.map(async ({ name, command, args }) => {
        const result = await runCommandQuiet(command, args)
        return { name, ...result }
      }),
    )

    // Check for failures
    const failures = results.filter(r => r.exitCode !== 0)

    if (failures.length > 0) {
      if (!quiet) {
        spinner.fail('Some checks failed')
      }

      // Show failures
      for (const { name, stdout, stderr } of failures) {
        if (!quiet) {
          logger.error(`${name} check failed`)
        }
        if (stdout) {
          console.log(stdout)
        }
        if (stderr) {
          console.error(stderr)
        }
      }

      process.exitCode = 1
    } else {
      if (!quiet) {
        spinner.success('All checks passed')
        console.log()
        logger.success('All checks passed!')
      }
    }
  } catch (error) {
    logger.error(`Check failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)
