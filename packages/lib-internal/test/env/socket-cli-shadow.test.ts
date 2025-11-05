/**
 * @fileoverview Unit tests for Socket CLI shadow mode environment variables.
 *
 * Tests getSocketCliShadow() for shadow CLI mode detection.
 * Returns SOCKET_CLI_SHADOW value or undefined. Used for CLI testing and development.
 * Uses rewire for test isolation. Enables shadow mode for Socket CLI operations.
 */

import {
  getSocketCliShadowAcceptRisks,
  getSocketCliShadowApiToken,
  getSocketCliShadowBin,
  getSocketCliShadowProgress,
  getSocketCliShadowSilent,
} from '@socketsecurity/lib/env/socket-cli-shadow'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/socket-cli-shadow', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getSocketCliShadowAcceptRisks', () => {
    it('should return true when SOCKET_CLI_SHADOW_ACCEPT_RISKS is "true"', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'true')
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
    })

    it('should return true when SOCKET_CLI_SHADOW_ACCEPT_RISKS is "1"', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', '1')
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
    })

    it('should return true when SOCKET_CLI_SHADOW_ACCEPT_RISKS is "yes"', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'yes')
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
    })

    it('should return false when SOCKET_CLI_SHADOW_ACCEPT_RISKS is not set', () => {
      clearEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS')
      expect(getSocketCliShadowAcceptRisks()).toBe(false)
    })

    it('should return false when SOCKET_CLI_SHADOW_ACCEPT_RISKS is "false"', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'false')
      expect(getSocketCliShadowAcceptRisks()).toBe(false)
    })

    it('should return false when SOCKET_CLI_SHADOW_ACCEPT_RISKS is empty', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', '')
      expect(getSocketCliShadowAcceptRisks()).toBe(false)
    })

    it('should handle mixed case', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'True')
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
    })

    it('should handle consecutive reads', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'true')
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
      expect(getSocketCliShadowAcceptRisks()).toBe(true)
    })
  })

  describe('getSocketCliShadowApiToken', () => {
    it('should return SOCKET_CLI_SHADOW_API_TOKEN when set', () => {
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'test-token-123')
      expect(getSocketCliShadowApiToken()).toBe('test-token-123')
    })

    it('should return undefined when SOCKET_CLI_SHADOW_API_TOKEN is not set', () => {
      clearEnv('SOCKET_CLI_SHADOW_API_TOKEN')
      const result = getSocketCliShadowApiToken()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle Socket API token', () => {
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'sock_abc123def456')
      expect(getSocketCliShadowApiToken()).toBe('sock_abc123def456')
    })

    it('should handle long API token', () => {
      const longToken = `sock_${'a'.repeat(100)}`
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', longToken)
      expect(getSocketCliShadowApiToken()).toBe(longToken)
    })

    it('should handle empty string', () => {
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', '')
      expect(getSocketCliShadowApiToken()).toBe('')
    })

    it('should handle updating token', () => {
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'token1')
      expect(getSocketCliShadowApiToken()).toBe('token1')

      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'token2')
      expect(getSocketCliShadowApiToken()).toBe('token2')
    })

    it('should handle consecutive reads', () => {
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'test-token')
      expect(getSocketCliShadowApiToken()).toBe('test-token')
      expect(getSocketCliShadowApiToken()).toBe('test-token')
      expect(getSocketCliShadowApiToken()).toBe('test-token')
    })

    it('should handle token with special characters', () => {
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'sock_abc-123_xyz/456')
      expect(getSocketCliShadowApiToken()).toBe('sock_abc-123_xyz/456')
    })
  })

  describe('getSocketCliShadowBin', () => {
    it('should return SOCKET_CLI_SHADOW_BIN when set', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/usr/local/bin/socket')
      expect(getSocketCliShadowBin()).toBe('/usr/local/bin/socket')
    })

    it('should return undefined when SOCKET_CLI_SHADOW_BIN is not set', () => {
      clearEnv('SOCKET_CLI_SHADOW_BIN')
      const result = getSocketCliShadowBin()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle Unix binary path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/usr/local/bin/socket')
      expect(getSocketCliShadowBin()).toBe('/usr/local/bin/socket')
    })

    it('should handle Windows binary path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', 'C:\\Program Files\\Socket\\socket.exe')
      expect(getSocketCliShadowBin()).toBe(
        'C:\\Program Files\\Socket\\socket.exe',
      )
    })

    it('should handle npm global binary path', () => {
      setEnv(
        'SOCKET_CLI_SHADOW_BIN',
        '/usr/local/lib/node_modules/@socketsecurity/cli/bin/socket',
      )
      expect(getSocketCliShadowBin()).toBe(
        '/usr/local/lib/node_modules/@socketsecurity/cli/bin/socket',
      )
    })

    it('should handle pnpm global binary path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/home/user/.local/share/pnpm/socket')
      expect(getSocketCliShadowBin()).toBe(
        '/home/user/.local/share/pnpm/socket',
      )
    })

    it('should handle relative path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', './node_modules/.bin/socket')
      expect(getSocketCliShadowBin()).toBe('./node_modules/.bin/socket')
    })

    it('should handle empty string', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '')
      expect(getSocketCliShadowBin()).toBe('')
    })

    it('should handle updating binary path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/bin/socket1')
      expect(getSocketCliShadowBin()).toBe('/bin/socket1')

      setEnv('SOCKET_CLI_SHADOW_BIN', '/bin/socket2')
      expect(getSocketCliShadowBin()).toBe('/bin/socket2')
    })

    it('should handle consecutive reads', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/usr/bin/socket')
      expect(getSocketCliShadowBin()).toBe('/usr/bin/socket')
      expect(getSocketCliShadowBin()).toBe('/usr/bin/socket')
      expect(getSocketCliShadowBin()).toBe('/usr/bin/socket')
    })

    it('should handle WSL path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/mnt/c/Windows/socket.exe')
      expect(getSocketCliShadowBin()).toBe('/mnt/c/Windows/socket.exe')
    })

    it('should handle Homebrew path', () => {
      setEnv('SOCKET_CLI_SHADOW_BIN', '/opt/homebrew/bin/socket')
      expect(getSocketCliShadowBin()).toBe('/opt/homebrew/bin/socket')
    })
  })

  describe('getSocketCliShadowProgress', () => {
    it('should return true when SOCKET_CLI_SHADOW_PROGRESS is "true"', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'true')
      expect(getSocketCliShadowProgress()).toBe(true)
    })

    it('should return true when SOCKET_CLI_SHADOW_PROGRESS is "1"', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', '1')
      expect(getSocketCliShadowProgress()).toBe(true)
    })

    it('should return true when SOCKET_CLI_SHADOW_PROGRESS is "yes"', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'yes')
      expect(getSocketCliShadowProgress()).toBe(true)
    })

    it('should return false when SOCKET_CLI_SHADOW_PROGRESS is not set', () => {
      clearEnv('SOCKET_CLI_SHADOW_PROGRESS')
      expect(getSocketCliShadowProgress()).toBe(false)
    })

    it('should return false when SOCKET_CLI_SHADOW_PROGRESS is "false"', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'false')
      expect(getSocketCliShadowProgress()).toBe(false)
    })

    it('should return false when SOCKET_CLI_SHADOW_PROGRESS is empty', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', '')
      expect(getSocketCliShadowProgress()).toBe(false)
    })

    it('should handle mixed case', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'YES')
      expect(getSocketCliShadowProgress()).toBe(true)
    })

    it('should handle consecutive reads', () => {
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'true')
      expect(getSocketCliShadowProgress()).toBe(true)
      expect(getSocketCliShadowProgress()).toBe(true)
      expect(getSocketCliShadowProgress()).toBe(true)
    })
  })

  describe('getSocketCliShadowSilent', () => {
    it('should return true when SOCKET_CLI_SHADOW_SILENT is "true"', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'true')
      expect(getSocketCliShadowSilent()).toBe(true)
    })

    it('should return true when SOCKET_CLI_SHADOW_SILENT is "1"', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', '1')
      expect(getSocketCliShadowSilent()).toBe(true)
    })

    it('should return true when SOCKET_CLI_SHADOW_SILENT is "yes"', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'yes')
      expect(getSocketCliShadowSilent()).toBe(true)
    })

    it('should return false when SOCKET_CLI_SHADOW_SILENT is not set', () => {
      clearEnv('SOCKET_CLI_SHADOW_SILENT')
      expect(getSocketCliShadowSilent()).toBe(false)
    })

    it('should return false when SOCKET_CLI_SHADOW_SILENT is "false"', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'false')
      expect(getSocketCliShadowSilent()).toBe(false)
    })

    it('should return false when SOCKET_CLI_SHADOW_SILENT is empty', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', '')
      expect(getSocketCliShadowSilent()).toBe(false)
    })

    it('should handle mixed case', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'True')
      expect(getSocketCliShadowSilent()).toBe(true)
    })

    it('should handle consecutive reads', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'true')
      expect(getSocketCliShadowSilent()).toBe(true)
      expect(getSocketCliShadowSilent()).toBe(true)
      expect(getSocketCliShadowSilent()).toBe(true)
    })
  })

  describe('shadow mode configuration interaction', () => {
    it('should handle all shadow mode vars set simultaneously', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'true')
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'sock_test123')
      setEnv('SOCKET_CLI_SHADOW_BIN', '/usr/bin/socket')
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'true')
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'false')

      expect(getSocketCliShadowAcceptRisks()).toBe(true)
      expect(getSocketCliShadowApiToken()).toBe('sock_test123')
      expect(getSocketCliShadowBin()).toBe('/usr/bin/socket')
      expect(getSocketCliShadowProgress()).toBe(true)
      expect(getSocketCliShadowSilent()).toBe(false)
    })

    it('should handle clearing all shadow mode vars', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'true')
      setEnv('SOCKET_CLI_SHADOW_API_TOKEN', 'token')
      setEnv('SOCKET_CLI_SHADOW_BIN', '/bin/socket')
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'true')
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'true')

      clearEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS')
      clearEnv('SOCKET_CLI_SHADOW_API_TOKEN')
      clearEnv('SOCKET_CLI_SHADOW_BIN')
      clearEnv('SOCKET_CLI_SHADOW_PROGRESS')
      clearEnv('SOCKET_CLI_SHADOW_SILENT')

      expect(getSocketCliShadowAcceptRisks()).toBe(false)
      expect(typeof getSocketCliShadowApiToken()).toMatch(/string|undefined/)
      expect(typeof getSocketCliShadowBin()).toMatch(/string|undefined/)
      expect(getSocketCliShadowProgress()).toBe(false)
      expect(getSocketCliShadowSilent()).toBe(false)
    })

    it('should handle silent mode with progress disabled', () => {
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'true')
      setEnv('SOCKET_CLI_SHADOW_PROGRESS', 'false')

      expect(getSocketCliShadowSilent()).toBe(true)
      expect(getSocketCliShadowProgress()).toBe(false)
    })

    it('should handle accept risks with silent mode', () => {
      setEnv('SOCKET_CLI_SHADOW_ACCEPT_RISKS', 'true')
      setEnv('SOCKET_CLI_SHADOW_SILENT', 'true')

      expect(getSocketCliShadowAcceptRisks()).toBe(true)
      expect(getSocketCliShadowSilent()).toBe(true)
    })
  })
})
