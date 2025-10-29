#!/usr/bin/env node
/**
 * @fileoverview Unified e2e test runner
 * Runs pre-e2e build check, then executes vitest with appropriate binary flags.
 *
 * Usage:
 *   node scripts/e2e.mjs --js     # Test JS binary only
 *   node scripts/e2e.mjs --sea    # Test SEA binary only
 *   node scripts/e2e.mjs --smol   # Test smol binary only
 *   node scripts/e2e.mjs --all    # Test all binaries
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const MONOREPO_ROOT = path.resolve(ROOT_DIR, '../..')

const BINARY_PATHS = {
  __proto__: null,
  js: path.join(ROOT_DIR, 'bin/cli.js'),
  sea: path.join(MONOREPO_ROOT, 'packages/node-sea-builder/dist/socket-sea'),
  smol: path.join(MONOREPO_ROOT, 'packages/node-smol-builder/dist/socket-smol'),
}

const BINARY_FLAGS = {
  __proto__: null,
  all: {
    TEST_SEA_BINARY: '1',
    TEST_SMOL_BINARY: '1',
  },
  js: {},
  sea: {
    TEST_SEA_BINARY: '1',
  },
  smol: {
    TEST_SMOL_BINARY: '1',
  },
}

async function checkBinaryExists(binaryType) {
  // For explicit binary requests (js, sea, smol), require binary to exist.
  if (binaryType === 'js' || binaryType === 'sea' || binaryType === 'smol') {
    const binaryPath = BINARY_PATHS[binaryType]
    if (!existsSync(binaryPath)) {
      logger.error(`${colors.red('✗')} Binary not found: ${binaryPath}`)
      logger.log('')
      logger.log('The binary must be built before running e2e tests.')
      logger.log('Build commands:')
      if (binaryType === 'js') {
        logger.log('  pnpm run build')
      } else if (binaryType === 'sea') {
        logger.log('  pnpm --filter @socketbin/node-sea-builder run build')
      } else if (binaryType === 'smol') {
        logger.log('  pnpm --filter @socketbin/node-smol-builder run build')
      }
      logger.log('')
      return false
    }
    logger.log(`${colors.green('✓')} Binary found: ${binaryPath}`)
    logger.log('')
  }

  // For 'all', we'll skip missing binaries (handled by test suite).
  return true
}

async function runVitest(binaryType) {
  const envVars = BINARY_FLAGS[binaryType]
  logger.log(`${colors.blue('ℹ')} Running e2e tests for ${binaryType} binary...`)
  logger.log('')

  // Check if binary exists when explicitly requested.
  const binaryExists = await checkBinaryExists(binaryType)
  if (!binaryExists) {
    process.exit(1)
  }

  const result = await spawn(
    'dotenvx',
    [
      '-q',
      'run',
      '-f',
      '.env.e2e',
      '--',
      'vitest',
      'run',
      'test/e2e/binary-test-suite.e2e.test.mts',
      '--config',
      'vitest.e2e.config.mts',
    ],
    {
      env: {
        ...process.env,
        RUN_E2E_TESTS: '1', // Automatically enable tests when explicitly running e2e.mjs.
        ...envVars,
      },
      stdio: 'inherit',
    },
  )

  process.exit(result.code ?? 0)
}

async function main() {
  const args = process.argv.slice(2)
  const flag = args.find(arg => arg.startsWith('--'))?.slice(2)

  if (!flag || !BINARY_FLAGS[flag]) {
    logger.error('Invalid or missing flag')
    logger.log('')
    logger.log('Usage:')
    logger.log('  node scripts/e2e.mjs --js     # Test JS binary')
    logger.log('  node scripts/e2e.mjs --sea    # Test SEA binary')
    logger.log('  node scripts/e2e.mjs --smol   # Test smol binary')
    logger.log('  node scripts/e2e.mjs --all    # Test all binaries')
    logger.log('')
    process.exit(1)
  }

  await runVitest(flag)
}

main().catch(e => {
  logger.error('E2E test runner failed:', e)
  process.exit(1)
})
