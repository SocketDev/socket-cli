/**
 * @fileoverview Distribution integration test runner
 * Runs pre-test build check, then executes vitest with appropriate distribution flags.
 *
 * Usage:
 *   node scripts/integration.mjs --js     # Test JS distribution only
 *   node scripts/integration.mjs --sea    # Test SEA binary only
 *   node scripts/integration.mjs --smol   # Test smol binary only
 *   node scripts/integration.mjs --all    # Test all distributions
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const MONOREPO_ROOT = path.resolve(ROOT_DIR, '../..')
const NODE_MODULES_BIN_PATH = path.join(MONOREPO_ROOT, 'node_modules/.bin')

const BINARY_PATHS = {
  __proto__: null,
  js: path.join(ROOT_DIR, 'dist/index.js'),
  sea: path.join(MONOREPO_ROOT, 'packages/node-sea-builder/dist/socket-sea'),
  smol: path.join(MONOREPO_ROOT, 'packages/node-smol-builder/dist/socket-smol'),
}

const BINARY_FLAGS = {
  __proto__: null,
  all: {
    TEST_JS_BINARY: '1',
    TEST_SEA_BINARY: '1',
    TEST_SMOL_BINARY: '1',
  },
  js: {
    TEST_JS_BINARY: '1',
  },
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
      getDefaultLogger().error(
        `${colors.red('✗')} Binary not found: ${binaryPath}`,
      )
      getDefaultLogger().log('')
      getDefaultLogger().log(
        'The binary must be built before running e2e tests.',
      )
      getDefaultLogger().log('Build commands:')
      if (binaryType === 'js') {
        getDefaultLogger().log('  pnpm run build')
      } else if (binaryType === 'sea') {
        getDefaultLogger().log(
          '  pnpm --filter @socketbin/node-sea-builder run build',
        )
      } else if (binaryType === 'smol') {
        getDefaultLogger().log(
          '  pnpm --filter @socketbin/node-smol-builder run build',
        )
      }
      getDefaultLogger().log('')
      return false
    }
    getDefaultLogger().log(`${colors.green('✓')} Binary found: ${binaryPath}`)
    getDefaultLogger().log('')
  }

  // For 'all', we'll skip missing binaries (handled by test suite).
  return true
}

async function runVitest(binaryType) {
  const envVars = BINARY_FLAGS[binaryType]
  getDefaultLogger().log(
    `${colors.blue('ℹ')} Running distribution integration tests for ${binaryType}...`,
  )
  getDefaultLogger().log('')

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
      'test/integration/binary/binary-test-suite.test.mts',
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
    getDefaultLogger().error('Invalid or missing flag')
    getDefaultLogger().log('')
    getDefaultLogger().log('Usage:')
    getDefaultLogger().log(
      '  node scripts/integration.mjs --js     # Test JS distribution',
    )
    getDefaultLogger().log(
      '  node scripts/integration.mjs --sea    # Test SEA binary',
    )
    getDefaultLogger().log(
      '  node scripts/integration.mjs --smol   # Test smol binary',
    )
    getDefaultLogger().log(
      '  node scripts/integration.mjs --all    # Test all distributions',
    )
    getDefaultLogger().log('')
    process.exit(1)
  }

  await runVitest(flag)
}

main().catch(e => {
  getDefaultLogger().error('Integration test runner failed:', e)
  process.exit(1)
})
