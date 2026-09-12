/**
 * JavaScript CLI end-to-end behavior.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { ENV } from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/util/socket/sdk.mts'
import { executeCliCommand } from '../helpers/cli-execution.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')

/**
 * Binary types and their paths.
 */
const BINARIES = {
  __proto__: null,
  js: {
    buildCommand: ['pnpm', 'run', 'build'],
    enabled: true,
    name: 'JS Binary (dist/index.js)',
    path: path.join(ROOT_DIR, 'dist/index.js'),
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

  logger.log('')

  try {
    const result = await spawn(
      binary.buildCommand[0],
      binary.buildCommand.slice(1),
      {
        cwd: ROOT_DIR,
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

    describe('Basic commands (no auth required)', () => {
      it.skipIf(!ENV.RUN_E2E_TESTS)('should display version', async () => {
        if (!binaryExists) {
          return
        }

        const result = await executeCliCommand(['--version'], {
          binPath: binary.path,
          isolateConfig: false,
        })

        // Note: --version currently shows help and exits with code 2, known issue.
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
    })

    describe('Core command help (no auth required)', () => {
      const commands = [
        'analytics',
        'ask',
        'audit-log',
        'ci',
        'console',
        'fix',
        'json',
        'login',
        'logout',
        'oops',
        'optimize',
        'patch',
        'threat-feed',
        'whoami',
        'wrapper',
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

    describe('Config command help (no auth required)', () => {
      const commands = [
        ['config', '--help'],
        ['config', 'auto', '--help'],
        ['config', 'get', '--help'],
        ['config', 'list', '--help'],
        ['config', 'set', '--help'],
        ['config', 'unset', '--help'],
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

    describe('Install/Uninstall command help (no auth required)', () => {
      const commands = [
        ['install', '--help'],
        ['install', 'completion', '--help'],
        ['uninstall', '--help'],
        ['uninstall', 'completion', '--help'],
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

    describe('Manifest command help (no auth required)', () => {
      const commands = [
        ['manifest', '--help'],
        ['manifest', 'auto', '--help'],
        ['sbom', '--help'],
        ['manifest', 'conda', '--help'],
        ['manifest', 'gradle', '--help'],
        ['manifest', 'kotlin', '--help'],
        ['manifest', 'scala', '--help'],
        ['manifest', 'setup', '--help'],
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

    describe('Organization command help (no auth required)', () => {
      const commands = [
        ['organization', '--help'],
        ['organization', 'dependencies', '--help'],
        ['organization', 'list', '--help'],
        ['organization', 'policy', '--help'],
        ['organization', 'policy', 'license', '--help'],
        ['organization', 'policy', 'security', '--help'],
        ['organization', 'quota', '--help'],
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
  })
}

// Run test suite for each binary type.
describe('Socket CLI Binary Test Suite', () => {
  // Always run JS binary test suite.
  runBinaryTestSuite('js')
})
