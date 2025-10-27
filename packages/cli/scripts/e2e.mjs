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

import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

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

async function runPreE2E() {
  logger.log(`${colors.blue('ℹ')} Running pre-e2e build check...`)
  logger.log('')

  const result = await spawn('node', ['scripts/pre-e2e-build.mjs'], {
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error('Pre-e2e build check failed')
    process.exit(1)
  }

  return true
}

async function runVitest(binaryType) {
  const envVars = BINARY_FLAGS[binaryType]
  logger.log(`${colors.blue('ℹ')} Running e2e tests for ${binaryType} binary...`)
  logger.log('')

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

  await runPreE2E()
  await runVitest(flag)
}

main().catch(e => {
  logger.error('E2E test runner failed:', e)
  process.exit(1)
})
