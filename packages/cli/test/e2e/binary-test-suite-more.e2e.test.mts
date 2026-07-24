/**
 * @file Comprehensive E2E test suite for all Socket CLI binary types. Tests
 *   the package, package-manager-wrapper, repository, scan, auth-required,
 *   and performance command groups across 3 binary types:
 *
 *   - JS binary (npm CLI) - Always tested
 *   - SEA binary (Single Executable Application) - Optional via TEST_SEA_BINARY=1
 *   - Smol binary - Optional via TEST_SMOL_BINARY=1 Auto-build feature:
 *   - Missing binaries are automatically built without prompting (CI and local)
 *   - All builds use prebuilt binaries from socket-btm + binject (fast) Coverage:
 *   - Package commands (3): package, package score, package shallow
 *   - Package manager wrappers (13): bundler, cargo, gem, go, npm, npx, nuget,
 *     pip, pnpm, raw-npm, raw-npx, uv, yarn
 *   - Repository commands (6): repository, repository create, repository del,
 *     repository list, repository update, repository view
 *   - Scan commands (11): scan, scan create, scan del, scan diff, scan github,
 *     scan list, scan metadata, scan reach, scan report, scan setup, scan view
 *   - Auth-required commands: config list, whoami
 *   - Performance validation: help commands execute within 5 seconds The
 *     core/config/install-uninstall/manifest/organization command groups live
 *     in `binary-test-suite.e2e.test.mts`. Test strategy:
 *   - Minimum test per command: --help (validates command loads without auth)
 *   - Auth-required commands: Basic execution test (with Socket API token)
 *   - Performance validation: Help commands execute within 5 seconds
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { ENV } from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/util/socket/sdk.mts'
import {
  executeCliCommand,
  executeCliInScratch,
} from '../helpers/cli-execution.mts'

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
    buildCommand: [
      'pnpm',
      '--filter',
      '@socketsecurity/cli',
      'run',
      'build:js',
    ],
    enabled: true,
    name: 'JS Binary (dist/cli.js)',
    path: path.join(ROOT_DIR, 'dist/cli.js'),
  },
  sea: {
    buildCommand: [
      'pnpm',
      '--filter',
      '@socketsecurity/cli',
      'run',
      'build:sea',
    ],
    enabled: !!process.env.TEST_SEA_BINARY,
    name: 'SEA Binary (Single Executable Application)',
    path: path.join(ROOT_DIR, 'dist/sea/socket-sea'),
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
export async function buildBinary(
  binaryType: keyof typeof BINARIES,
): Promise<boolean> {
  const binary = BINARIES[binaryType]

  if (!binary.buildCommand) {
    return false
  }

  logger.log(`Building ${binary.name}...`)
  logger.log(`Running: ${binary.buildCommand.join(' ')}`)

  if (binaryType === 'smol') {
    logger.log('Note: smol build may take 30-60 minutes on first build')
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

  describe(binary.name, () => {
    let hasAuth = false
    let binaryExists = false

    beforeAll(async () => {
      // Check if binary exists.
      binaryExists = existsSync(binary.path)

      if (!binaryExists) {
        logger.log('')
        logger.warn(`Binary not found: ${binary.path}`)

        // All builds are fast (use prebuilt binaries from socket-btm + binject).
        logger.log(`Auto-building ${binary.name}...`)

        const buildSuccess = await buildBinary(binaryType)

        if (buildSuccess) {
          binaryExists = existsSync(binary.path)
        }

        if (!binaryExists) {
          logger.log('')
          logger.error(`Failed to build ${binary.name}. Tests will be skipped.`)
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
        const apiToken = getDefaultApiToken()
        hasAuth = !!apiToken
        if (!apiToken) {
          logger.log('')
          logger.warn('E2E tests require Socket authentication.')
          logger.log('Please run one of the following:')
          logger.log('  1. socket login (to authenticate with Socket)')
          logger.log('  2. Set SOCKET_SECURITY_API_KEY environment variable')
          logger.log('  3. Skip E2E tests by not setting RUN_E2E_TESTS')
          logger.log('')
          logger.log('E2E tests will be skipped due to missing authentication.')
          logger.log('')
        }
      }
    })

    describe('Package command help (no auth required)', () => {
      const commands = [
        ['package', '--help'],
        ['package', 'score', '--help'],
        ['package', 'shallow', '--help'],
      ]

      for (let i = 0, { length } = commands; i < length; i += 1) {
        const cmd = commands[i]
        it.skipIf(!ENV.RUN_E2E_TESTS)(
          `should display ${cmd.join(' ')} help`,
          async () => {
            if (!binaryExists) {
              return
            }

            const result = await executeCliCommand(cmd, {
              binPath: binary.path,
              isolateConfig: false,
            })

            expect(result.code).toBe(0)
            expect(result.stdout.length).toBeGreaterThan(0)
          },
        )
      }
    })

    describe('Package manager wrapper command help (no auth required)', () => {
      const commands = [
        'bundler',
        'cargo',
        'gem',
        'go',
        'npm',
        'npx',
        'nuget',
        'pip',
        'pnpm',
        'raw-npm',
        'raw-npx',
        'uv',
        'yarn',
      ]

      for (let i = 0, { length } = commands; i < length; i += 1) {
        const cmd = commands[i]
        it.skipIf(!ENV.RUN_E2E_TESTS)(
          `should display ${cmd} command help`,
          async () => {
            if (!binaryExists) {
              return
            }

            const result = await executeCliCommand([cmd, '--help'], {
              binPath: binary.path,
              isolateConfig: false,
            })

            expect(result.code).toBe(0)
            expect(result.stdout.length).toBeGreaterThan(0)
          },
        )
      }
    })

    describe('Repository command help (no auth required)', () => {
      const commands = [
        ['repository', '--help'],
        ['repository', 'create', '--help'],
        ['repository', 'del', '--help'],
        ['repository', 'list', '--help'],
        ['repository', 'update', '--help'],
        ['repository', 'view', '--help'],
      ]

      for (let i = 0, { length } = commands; i < length; i += 1) {
        const cmd = commands[i]
        it.skipIf(!ENV.RUN_E2E_TESTS)(
          `should display ${cmd.join(' ')} help`,
          async () => {
            if (!binaryExists) {
              return
            }

            const result = await executeCliCommand(cmd, {
              binPath: binary.path,
              isolateConfig: false,
            })

            expect(result.code).toBe(0)
            expect(result.stdout.length).toBeGreaterThan(0)
          },
        )
      }
    })

    describe('Scan command help (no auth required)', () => {
      const commands = [
        ['scan', '--help'],
        ['scan', 'create', '--help'],
        ['scan', 'del', '--help'],
        ['scan', 'diff', '--help'],
        ['scan', 'github', '--help'],
        ['scan', 'list', '--help'],
        ['scan', 'metadata', '--help'],
        ['scan', 'reach', '--help'],
        ['scan', 'report', '--help'],
        ['scan', 'setup', '--help'],
        ['scan', 'view', '--help'],
      ]

      for (let i = 0, { length } = commands; i < length; i += 1) {
        const cmd = commands[i]
        it.skipIf(!ENV.RUN_E2E_TESTS)(
          `should display ${cmd.join(' ')} help`,
          async () => {
            if (!binaryExists) {
              return
            }

            const result = await executeCliCommand(cmd, {
              binPath: binary.path,
              isolateConfig: false,
            })

            expect(result.code).toBe(0)
            expect(result.stdout.length).toBeGreaterThan(0)
          },
        )
      }
    })

    describe('Auth-required commands', () => {
      it.skipIf(!ENV.RUN_E2E_TESTS)('should list config settings', async () => {
        if (!binaryExists || !hasAuth) {
          return
        }

        // Scratch HOME so the test can't read the dev's real Socket config.
        const result = await executeCliInScratch(['config', 'list'], {
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

          // Scratch HOME so the API call uses the env-supplied token but
          // can't persist anything back into the dev's config / keychain.
          const result = await executeCliInScratch(['whoami'], {
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
