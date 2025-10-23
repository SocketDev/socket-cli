/**
 * @fileoverview Tests for whoami command.
 * Validates authentication status display with various token sources.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_HELP, FLAG_JSON } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket whoami', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original environment.
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    // Restore original environment.
    process.env = originalEnv
  })

  describe('help output', () => {
    cmdit(['whoami', FLAG_HELP], 'should show help', async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      expect(code).toBe(0)
      expect(stderr).toContain('whoami')
      expect(stderr).toContain('Check if you are authenticated')
      expect(stderr).toContain('Examples')
      expect(stdout).toBe('')
    })
  })

  describe('authenticated with API token', () => {
    // Test token - not a real API key.
    const testToken = 'sktsec_test123456789'

    cmdit(
      ['whoami', FLAG_CONFIG, `{"apiToken":"${testToken}"}`],
      'should show authenticated status',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stderr).toContain('Authenticated with Socket')
        expect(stderr).toContain('Token: sktsec_')
        expect(stderr).toContain('Source:')
        expect(stdout).toBe('')
      },
    )

    cmdit(
      ['whoami', FLAG_JSON, FLAG_CONFIG, `{"apiToken":"${testToken}"}`],
      'should output JSON format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stdout).toContain('"authenticated":true')
        expect(stdout).toContain('"token":"sktsec_')
        expect(stdout).toContain('"location":')
        expect(stderr).toBe('')
      },
    )
  })

  describe('not authenticated', () => {
    cmdit(
      ['whoami', FLAG_CONFIG, '{}'],
      'should show not authenticated',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          env: {
            ...process.env,
            // Explicitly unset any API token environment variables.
            SOCKET_SECURITY_API_KEY: '',
            SOCKET_CLI_API_TOKEN: '',
          },
        })

        expect(code).toBe(0)
        expect(stderr).toContain('Not authenticated with Socket')
        expect(stderr).toContain('To authenticate')
        expect(stderr).toContain('socket login')
        expect(stdout).toBe('')
      },
    )

    cmdit(
      ['whoami', FLAG_JSON, FLAG_CONFIG, '{}'],
      'should output JSON format when not authenticated',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          env: {
            ...process.env,
            SOCKET_SECURITY_API_KEY: '',
            SOCKET_CLI_API_TOKEN: '',
          },
        })

        expect(code).toBe(0)
        expect(stdout).toContain('"authenticated":false')
        expect(stdout).toContain('"token":null')
        expect(stdout).toContain('"location":null')
        expect(stderr).toBe('')
      },
    )
  })

  describe('token display', () => {
    cmdit(
      [
        'whoami',
        FLAG_CONFIG,
        '{"apiToken":"sktsec_abcdefghijklmnopqrstuvwxyz"}',
      ],
      'should mask token after prefix',
      async cmd => {
        const { code, stderr } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stderr).toContain('Token: sktsec_')
        expect(stderr).toContain('...')
        // Should not contain full token.
        expect(stderr).not.toContain('abcdefghijklmnopqrstuvwxyz')
      },
    )
  })

  describe('token source detection', () => {
    cmdit(
      ['whoami', FLAG_CONFIG, '{"apiToken":"sktsec_from_config"}'],
      'should detect config file source',
      async cmd => {
        const { code, stderr } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stderr).toContain('Source:')
        expect(stderr).toContain('Config file')
      },
    )
  })

  describe('error handling', () => {
    cmdit(
      ['whoami', '--invalid-flag'],
      'should handle invalid flags',
      async cmd => {
        const { code, stderr } = await spawnSocketCli(binCliPath, cmd)

        expect(code).not.toBe(0)
        expect(stderr).toContain('Unknown option')
      },
    )
  })
})
