/**
 * Unit tests for Socket constants.
 *
 * Purpose:
 * Tests the Socket.dev specific constants for the CLI.
 *
 * Test Coverage:
 * - API URL constants
 * - Configuration file constants
 * - Repository metadata constants
 * - Scan type constants
 * - Token constants
 *
 * Related Files:
 * - constants/socket.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  API_V0_URL,
  NPM_REGISTRY_URL,
  SCAN_TYPE_SOCKET,
  SCAN_TYPE_SOCKET_TIER1,
  SOCKET_CLI_ISSUES_URL,
  SOCKET_DEFAULT_BRANCH,
  SOCKET_DEFAULT_REPOSITORY,
  SOCKET_JSON,
  SOCKET_WEBSITE_URL,
  SOCKET_YAML,
  SOCKET_YML,
  TOKEN_PREFIX,
  TOKEN_PREFIX_LENGTH,
  V1_MIGRATION_GUIDE_URL,
} from '../../../src/constants/socket.mts'

describe('socket constants', () => {
  describe('API URL constants', () => {
    it('has API_V0_URL constant', () => {
      expect(API_V0_URL).toBe('https://api.socket.dev/v0/')
    })

    it('has SOCKET_WEBSITE_URL constant', () => {
      expect(SOCKET_WEBSITE_URL).toBe('https://socket.dev')
    })

    it('has NPM_REGISTRY_URL constant', () => {
      expect(NPM_REGISTRY_URL).toContain('registry')
      expect(NPM_REGISTRY_URL).toContain('npm')
    })
  })

  describe('configuration file constants', () => {
    it('has SOCKET_JSON constant', () => {
      expect(SOCKET_JSON).toBe('socket.json')
    })

    it('has SOCKET_YAML constant', () => {
      expect(SOCKET_YAML).toBe('socket.yaml')
    })

    it('has SOCKET_YML constant', () => {
      expect(SOCKET_YML).toBe('socket.yml')
    })
  })

  describe('repository metadata constants', () => {
    it('has SOCKET_DEFAULT_BRANCH constant', () => {
      expect(SOCKET_DEFAULT_BRANCH).toBe('socket-default-branch')
    })

    it('has SOCKET_DEFAULT_REPOSITORY constant', () => {
      expect(SOCKET_DEFAULT_REPOSITORY).toBe('socket-default-repository')
    })
  })

  describe('scan type constants', () => {
    it('has SCAN_TYPE_SOCKET constant', () => {
      expect(SCAN_TYPE_SOCKET).toBe('socket')
    })

    it('has SCAN_TYPE_SOCKET_TIER1 constant', () => {
      expect(SCAN_TYPE_SOCKET_TIER1).toBe('socket_tier1')
    })
  })

  describe('token constants', () => {
    it('has TOKEN_PREFIX constant', () => {
      expect(TOKEN_PREFIX).toBe('sktsec_')
    })

    it('has TOKEN_PREFIX_LENGTH constant', () => {
      expect(TOKEN_PREFIX_LENGTH).toBe(TOKEN_PREFIX.length)
      expect(TOKEN_PREFIX_LENGTH).toBe(7)
    })
  })

  describe('documentation constants', () => {
    it('has V1_MIGRATION_GUIDE_URL constant', () => {
      expect(V1_MIGRATION_GUIDE_URL).toContain('docs.socket.dev')
      expect(V1_MIGRATION_GUIDE_URL).toContain('migration')
    })

    it('has SOCKET_CLI_ISSUES_URL constant', () => {
      expect(SOCKET_CLI_ISSUES_URL).toContain('github.com')
      expect(SOCKET_CLI_ISSUES_URL).toContain('socket-cli')
      expect(SOCKET_CLI_ISSUES_URL).toContain('issues')
    })
  })
})
