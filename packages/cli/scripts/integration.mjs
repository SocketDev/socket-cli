/**
 * Integration test runner.
 * Options: --js, --sea, --all
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const MONOREPO_ROOT = path.resolve(ROOT_DIR, '../..')
const NODE_MODULES_BIN_PATH = path.join(MONOREPO_ROOT, 'node_modules/.bin')

const BINARY_PATHS = {
  __proto__: null,
  js: path.join(ROOT_DIR, 'dist/index.js'),
  sea: path.join(MONOREPO_ROOT, 'packages/node-sea-builder/dist/socket-sea'),
}

const BINARY_FLAGS = {
  __proto__: null,
  all: {
    TEST_JS_BINARY: '1',
    TEST_SEA_BINARY: '1',
  },
  js: {
    TEST_JS_BINARY: '1',
  },
  sea: {
    TEST_SEA_BINARY: '1',
  },
}

async function checkBinaryExists(binaryType) {
  // For explicit binary requests (js, sea), require binary to exist.
  if (binaryType === 'js' || binaryType === 'sea') {
    const binaryPath = BINARY_PATHS[binaryType]
    if (!existsSync(binaryPath)) {
      logger.error(`${colors.red('✗')} Binary not found: ${binaryPath}`)
      logger.log('')
      logger.log('The binary must be built before running integration tests.')
      logger.log('Build commands:')
      if (binaryType === 'js') {
        logger.log('  pnpm run build')
      } else if (binaryType === 'sea') {
        logger.log('  pnpm --filter @socketbin/node-sea-builder run build')
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
  logger.log(
    `${colors.blue('ℹ')} Running distribution integration tests for ${binaryType}...`,
  )
  logger.log('')

  // Check if binary exists when explicitly requested.
  const binaryExists = await checkBinaryExists(binaryType)
  if (!binaryExists) {
    process.exit(1)
  }

  // Use dotenvx to load test environment.
  const dotenvxCmd = WIN32 ? 'dotenvx.cmd' : 'dotenvx'
  const dotenvxPath = path.join(NODE_MODULES_BIN_PATH, dotenvxCmd)

  // Resolve vitest path.
  const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
  const vitestPath = path.join(NODE_MODULES_BIN_PATH, vitestCmd)

  const result = await spawn(
    dotenvxPath,
    [
      '-q',
      'run',
      '-f',
      '.env.test',
      '--',
      vitestPath,
      'run',
      'test/integration/binary/',
      '--config',
      'vitest.integration.config.mts',
    ],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        RUN_INTEGRATION_TESTS: '1', // Automatically enable tests when explicitly running integration.mjs.
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
    logger.log('  node scripts/integration.mjs --js     # Test JS distribution')
    logger.log('  node scripts/integration.mjs --sea    # Test SEA binary')
    logger.log(
      '  node scripts/integration.mjs --all    # Test all distributions',
    )
    logger.log('')
    process.exit(1)
  }

  await runVitest(flag)
}

main().catch(e => {
  logger.error('Integration test runner failed:', e)
  process.exit(1)
})
