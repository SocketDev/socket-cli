/**
 * E2E test runner.
 * Options: --js, --sea, --all
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { EnvironmentVariables } from './environment-variables.mjs'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const MONOREPO_ROOT = path.resolve(ROOT_DIR, '../..')
const NODE_MODULES_BIN_PATH = path.join(MONOREPO_ROOT, 'node_modules/.bin')

const BINARY_PATHS = {
  __proto__: null,
  js: path.join(ROOT_DIR, 'dist/cli.js'),
  sea: path.join(ROOT_DIR, 'dist/sea/socket-sea'),
}

const BINARY_BUILD_COMMANDS = {
  __proto__: null,
  js: ['pnpm', '--filter', '@socketsecurity/cli', 'run', 'build:js'],
  sea: ['pnpm', '--filter', '@socketsecurity/cli', 'run', 'build:sea'],
}

const BINARY_FLAGS = {
  __proto__: null,
  all: {
    TEST_SEA_BINARY: '1',
  },
  js: {},
  sea: {
    TEST_SEA_BINARY: '1',
  },
}

async function buildBinary(binaryType) {
  const buildCommand = BINARY_BUILD_COMMANDS[binaryType]
  if (!buildCommand) {
    logger.error('No build command defined for binary type:', binaryType)
    return false
  }

  logger.log(`${colors.blue('⚙')} Building ${binaryType} binary...`)
  logger.log(`${colors.dim(`  ${buildCommand.join(' ')}`)}`)
  logger.log('')

  try {
    const result = await spawn(buildCommand[0], buildCommand.slice(1), {
      cwd: MONOREPO_ROOT,
      stdio: 'inherit',
    })

    if (result.code !== 0) {
      logger.error(`${colors.red('✗')} Failed to build ${binaryType} binary`)
      return false
    }

    logger.log(`${colors.green('✓')} Successfully built ${binaryType} binary`)
    logger.log('')
    return true
  } catch (e) {
    logger.error(`${colors.red('✗')} Error building ${binaryType} binary:`, e)
    return false
  }
}

async function checkBinaryExists(binaryType) {
  // For explicit binary requests (js, sea), check and auto-build if needed.
  if (binaryType === 'js' || binaryType === 'sea') {
    const binaryPath = BINARY_PATHS[binaryType]
    if (!existsSync(binaryPath)) {
      logger.log('')
      logger.warn(`${colors.yellow('⚠')} Binary not found: ${binaryPath}`)
      logger.log('')

      // Auto-build (builds are fast using prebuilt binaries + binject).
      logger.log('Auto-building missing binary...')
      const buildSuccess = await buildBinary(binaryType)

      if (!buildSuccess || !existsSync(binaryPath)) {
        logger.error(`${colors.red('✗')} Failed to build ${binaryType} binary`)
        logger.log('To build manually, run:')
        logger.log(`  ${BINARY_BUILD_COMMANDS[binaryType].join(' ')}`)
        logger.log('')
        return false
      }
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
    `${colors.blue('ℹ')} Running e2e tests for ${binaryType} binary...`,
  )
  logger.log('')

  // Check if binary exists when explicitly requested.
  const binaryExists = await checkBinaryExists(binaryType)
  if (!binaryExists) {
    process.exit(1)
  }

  // Load external tool versions for INLINED_* env vars.
  // This is required for tests to load external tool versions (coana, cdxgen, synp, etc).
  const externalToolVersions = EnvironmentVariables.getTestVariables()

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
      '.env.e2e',
      '--',
      vitestPath,
      'run',
      'test/e2e/binary-test-suite.e2e.test.mts',
      '--config',
      'vitest.e2e.config.mts',
    ],
    {
      env: {
        ...process.env,
        // Automatically enable tests when explicitly running e2e.mjs.
        RUN_E2E_TESTS: '1',
        // Load external tool versions (INLINED_* env vars).
        ...externalToolVersions,
        // Binary-specific test flags.
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
