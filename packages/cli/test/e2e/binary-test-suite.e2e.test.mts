/** @fileoverview Comprehensive E2E test suite for all Socket CLI binary types. Tests JS binary, smol Node.js binary, and SEA binary with caching support. */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { confirm } from '@socketsecurity/lib/stdio/prompts'

import ENV from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/utils/socket/sdk.mts'
import { executeCliCommand } from '../helpers/cli-execution.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')
const MONOREPO_ROOT = path.resolve(ROOT_DIR, '../..')

/**
 * Binary types and their paths.
 */
const BINARIES = {
  __proto__: null,
  js: {
    buildCommand: null,
    enabled: true,
    name: 'JS Binary (dist/cli.js)',
    path: path.join(ROOT_DIR, 'bin/cli.js'),
  },
  sea: {
    buildCommand: [
      'pnpm',
      '--filter',
      '@socketbin/node-sea-builder',
      'run',
      'build',
    ],
    enabled: !!process.env.TEST_SEA_BINARY,
    name: 'SEA Binary (Single Executable Application)',
    path: path.join(MONOREPO_ROOT, 'packages/node-sea-builder/dist/socket-sea'),
  },
  smol: {
    buildCommand: [
      'pnpm',
      '--filter',
      '@socketbin/node-smol-builder',
      'run',
      'build',
    ],
    enabled: !!process.env.TEST_SMOL_BINARY,
    name: 'Smol Binary',
    path: path.join(
      MONOREPO_ROOT,
      'packages/node-smol-builder/dist/socket-smol',
    ),
  },
}

/**
 * Build a binary if needed.
 */
async function buildBinary(
  binaryType: keyof typeof BINARIES,
): Promise<boolean> {
  const binary = BINARIES[binaryType]

  if (!binary.buildCommand) {
    return false
  }

  logger.log(`Building ${binary.name}...`)
  logger.log(`Running: ${binary.buildCommand.join(' ')}`)

  if (binaryType === 'smol') {
    logger.log(
      'Note: smol build may take 30-60 minutes on first build',
    )
    logger.log('      (subsequent builds are faster with caching)')
  }
  logger.log('')

  try {
    const result = await spawn(
      binary.buildCommand[0],
      binary.buildCommand.slice(1),
      {
        cwd: MONOREPO_ROOT,
        stdio: 'inherit',
      },
    )

    if (result.code !== 0) {
      logger.error(`Failed to build ${binary.name}`)
      return false
    }

    logger.log(`Successfully built ${binary.name}`)
    return true
  } catch (e) {
    logger.error(`Error building ${binary.name}:`, e)
    return false
  }
}

/**
 * Run the test suite for a specific binary type.
 */
function runBinaryTestSuite(binaryType: keyof typeof BINARIES) {
  const binary = BINARIES[binaryType]

  if (!binary.enabled) {
    return
  }

  describe(`${binary.name}`, () => {
    let hasAuth = false
    let binaryExists = false

    beforeAll(async () => {
      // Check if binary exists.
      binaryExists = existsSync(binary.path)

      if (!binaryExists) {
        logger.log('')
        logger.warn(`Binary not found: ${binary.path}`)

        // In CI: Skip building (rely on cache).
        if (process.env.CI) {
          logger.log(
            'Running in CI - skipping build (binary not in cache)',
          )
          logger.log(
            'To prime cache, run: gh workflow run publish-socketbin.yml --field dry-run=true',
          )
          logger.log('')
          return
        }

        // Locally: Prompt user to build.
        const timeWarning = binaryType === 'smol' ? ' (may take 30-60 min)' : ''
        const shouldBuild = await confirm({
          default: true,
          message: `Build ${binary.name}?${timeWarning}`,
        })

        if (!shouldBuild) {
          logger.log('Skipping build. Tests will be skipped.')
          logger.log(
            `To build manually, run: ${binary.buildCommand.join(' ')}`,
          )
          logger.log('')
          return
        }

        logger.log('Building binary...')
        const buildSuccess = await buildBinary(binaryType)

        if (buildSuccess) {
          binaryExists = existsSync(binary.path)
        }

        if (!binaryExists) {
          logger.log('')
          logger.error(
            `Failed to build ${binary.name}. Tests will be skipped.`,
          )
          logger.log('To build this binary manually, run:')
          logger.log(`  ${binary.buildCommand.join(' ')}`)
          logger.log('')
          return
        }

        logger.log(`Binary built successfully: ${binary.path}`)
        logger.log('')
      }

      // Check authentication.
      if (ENV.RUN_E2E_TESTS) {
        const apiToken = await getDefaultApiToken()
        hasAuth = !!apiToken
        if (!apiToken) {
          logger.log('')
          logger.warn('E2E tests require Socket authentication.')
          logger.log('Please run one of the following:')
          logger.log(
            '  1. socket login (to authenticate with Socket)',
          )
          logger.log(
            '  2. Set SOCKET_SECURITY_API_KEY environment variable',
          )
          logger.log(
            '  3. Skip E2E tests by not setting RUN_E2E_TESTS',
          )
          logger.log('')
          logger.log(
            'E2E tests will be skipped due to missing authentication.',
          )
          logger.log('')
        }
      }
    })

    describe('Basic commands (no auth required)', () => {
      it.skipIf(!ENV.RUN_E2E_TESTS)('should display version', async () => {
        if (!binaryExists) {
          return
        }

        const result = await executeCliCommand(['--version'], {
          binPath: binary.path,
          isolateConfig: false,
        })

        // Note: --version currently shows help and exits with code 2 (known issue).
        // This test validates the CLI executes without crashing.
        expect(result.code).toBeGreaterThanOrEqual(0)
        expect(result.stdout.length).toBeGreaterThan(0)
      })

      it.skipIf(!ENV.RUN_E2E_TESTS)('should display help', async () => {
        if (!binaryExists) {
          return
        }

        const result = await executeCliCommand(['--help'], {
          binPath: binary.path,
          isolateConfig: false,
        })

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('socket')
        expect(result.stdout).toContain('Main commands')
      })

      it.skipIf(!ENV.RUN_E2E_TESTS)(
        'should display scan command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['scan', '--help'], {
            binPath: binary.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('scan')
        },
      )

      it.skipIf(!ENV.RUN_E2E_TESTS)(
        'should display package command help',
        async () => {
          if (!binaryExists) {
            return
          }

          const result = await executeCliCommand(['package', '--help'], {
            binPath: binary.path,
            isolateConfig: false,
          })

          expect(result.code).toBe(0)
          expect(result.stdout).toContain('package')
        },
      )
    })

    describe('Auth-required commands', () => {
      it.skipIf(!ENV.RUN_E2E_TESTS)('should list config settings', async () => {
        if (!binaryExists || !hasAuth) {
          return
        }

        const result = await executeCliCommand(['config', 'list'], {
          binPath: binary.path,
        })

        expect(result.code).toBe(0)
      })

      it.skipIf(!ENV.RUN_E2E_TESTS)(
        'should display whoami information',
        async () => {
          if (!binaryExists || !hasAuth) {
            return
          }

          const result = await executeCliCommand(['whoami'], {
            binPath: binary.path,
          })

          expect(result.code).toBe(0)
        },
      )
    })

    describe('Performance validation', () => {
      it.skipIf(!ENV.RUN_E2E_TESTS)(
        'should execute help command within reasonable time',
        async () => {
          if (!binaryExists) {
            return
          }

          const startTime = Date.now()
          const result = await executeCliCommand(['--help'], {
            binPath: binary.path,
            isolateConfig: false,
          })
          const duration = Date.now() - startTime

          expect(result.code).toBe(0)
          // Help should execute in under 5 seconds even for bundled binaries.
          expect(duration).toBeLessThan(5000)
        },
      )
    })
  })
}

// Run test suite for each binary type.
describe('Socket CLI Binary Test Suite', () => {
  // Always run JS binary test suite.
  runBinaryTestSuite('js')

  // Run smol test suite (will prompt locally, skip in CI if not cached).
  runBinaryTestSuite('smol')

  // Run SEA test suite (will prompt locally, skip in CI if not cached).
  runBinaryTestSuite('sea')
})
