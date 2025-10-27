import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import ENV from '../../src/constants/env.mts'
import { getDefaultApiToken } from '../../src/utils/socket/sdk.mts'
import { executeCliCommand } from '../helpers/cli-execution.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_BIN_PATH = path.resolve(__dirname, '../../bin/cli.js')

describe('Critical CLI Commands E2E', () => {
  let hasAuth = false

  beforeAll(async () => {
    // Check if running E2E tests and if Socket API token is available.
    if (ENV.RUN_E2E_TESTS) {
      const apiToken = await getDefaultApiToken()
      hasAuth = !!apiToken
      if (!apiToken) {
        console.log()
        console.warn('E2E tests require Socket authentication.')
        console.log('Please run one of the following:')
        console.log('  1. socket login (to authenticate with Socket)')
        console.log('  2. Set SOCKET_SECURITY_API_KEY environment variable')
        console.log('  3. Skip E2E tests by not setting RUN_E2E_TESTS\n')
        console.log(
          'E2E tests will be skipped due to missing authentication.\n',
        )
      }
    }
  })

  describe('Basic commands (no auth required)', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS)('should display version', async () => {
      const result = await executeCliCommand(['--version'], {
        binPath: CLI_BIN_PATH,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/)
    })

    it.skipIf(!ENV.RUN_E2E_TESTS)('should display help', async () => {
      const result = await executeCliCommand(['--help'], {
        binPath: CLI_BIN_PATH,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('socket')
      expect(result.stdout).toContain('Commands')
    })

    it.skipIf(!ENV.RUN_E2E_TESTS)(
      'should display scan command help',
      async () => {
        const result = await executeCliCommand(['scan', '--help'], {
          binPath: CLI_BIN_PATH,
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('scan')
      },
    )
  })

  describe('Auth-required commands', () => {
    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'should list config settings',
      async () => {
        const result = await executeCliCommand(['config', 'list'], {
          binPath: CLI_BIN_PATH,
        })

        expect(result.exitCode).toBe(0)
      },
    )

    it.skipIf(!ENV.RUN_E2E_TESTS || !hasAuth)(
      'should display whoami information',
      async () => {
        const result = await executeCliCommand(['whoami'], {
          binPath: CLI_BIN_PATH,
        })

        expect(result.exitCode).toBe(0)
      },
    )
  })
})
