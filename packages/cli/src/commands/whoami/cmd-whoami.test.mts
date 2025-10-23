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
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

      expect(code).toBe(0)
      expect(stdout).toContain('whoami')
      expect(stdout).toContain('Check') // "Check Socket CLI authentication status" or "Check if you are authenticated"
      expect(stdout).toContain('Examples')
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
        expect(stdout).toContain('Token: sktsec_') // Token info is in stdout
        expect(stdout).toContain('Source:') // Source info is in stdout
      },
    )

    cmdit(
      ['whoami', FLAG_JSON, FLAG_CONFIG, `{"apiToken":"${testToken}"}`],
      'should output JSON format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stdout).toContain('"authenticated"') // JSON has spaces after colons
        expect(stdout).toContain('true')
        expect(stdout).toContain('"token"')
        expect(stdout).toContain('"location"')
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
        expect(stdout).toContain('To authenticate') // Instructions are in stdout
        expect(stdout).toContain('socket login')
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
        expect(stdout).toContain('"authenticated"') // JSON has spaces after colons
        expect(stdout).toContain('false')
        expect(stdout).toContain('"token"')
        expect(stdout).toContain('null')
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
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stdout).toContain('Token: sktsec_')
        expect(stdout).toContain('...')
        // Should not contain full token.
        expect(stdout).not.toContain('abcdefghijklmnopqrstuvwxyz')
      },
    )
  })

  describe('token source detection', () => {
    cmdit(
      ['whoami', FLAG_CONFIG, '{"apiToken":"sktsec_from_config"}'],
      'should detect config file source',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

        expect(code).toBe(0)
        expect(stdout).toContain('Source:')
        expect(stdout).toContain('Config file')
      },
    )
  })

  describe('error handling', () => {
    cmdit(
      ['whoami', '--invalid-flag'],
      'should ignore invalid flags gracefully',
      async cmd => {
        const { code } = await spawnSocketCli(binCliPath, cmd)

        // CLI ignores unknown flags and continues successfully.
        expect(code).toBe(0)
      },
    )
  })
})
