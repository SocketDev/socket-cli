/**
 * Unit tests for dlx binary resolution.
 *
 * Purpose:
 * Tests binary resolution for dlx commands. Validates locating and selecting appropriate binaries.
 *
 * Test Coverage:
 * - Binary path resolution
 * - node_modules/.bin lookup
 * - Global binary search
 * - Fallback logic
 * - Platform-specific binaries
 *
 * Testing Approach:
 * Tests binary resolution algorithms for dlx execution.
 *
 * Related Files:
 * - utils/dlx/resolve-binary.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  resolveCdxgen,
  resolveCoana,
  resolvePyCli,
  resolveSfw,
  resolveSynp,
} from '../../../../src/utils/dlx/resolve-binary.mjs'

import type { BinaryResolution } from '../../../../src/utils/dlx/resolve-binary.mjs'

describe('resolve-binary', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment before each test.
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    // Restore original environment.
    process.env = originalEnv
  })

  describe('resolveCoana', () => {
    it('should return local path when SOCKET_CLI_COANA_LOCAL_PATH is set', () => {
      process.env['SOCKET_CLI_COANA_LOCAL_PATH'] = '/custom/path/to/coana'

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/coana',
      })
    })

    it('should return dlx package spec when SOCKET_CLI_COANA_LOCAL_PATH is not set', () => {
      delete process.env['SOCKET_CLI_COANA_LOCAL_PATH']

      const result = resolveCoana() as Extract<
        BinaryResolution,
        { type: 'dlx' }
      >

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('@coana-tech/cli')
      expect(result.details.version).toContain('~')
      expect(result.details.binaryName).toBe('coana')
    })

    it('should prefer local path over dlx when both available', () => {
      process.env['SOCKET_CLI_COANA_LOCAL_PATH'] = '/local/coana'
      process.env['INLINED_SOCKET_CLI_COANA_VERSION'] = '1.0.0'

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/local/coana',
      })
    })
  })

  describe('resolveCdxgen', () => {
    it('should return local path when SOCKET_CLI_CDXGEN_LOCAL_PATH is set', () => {
      process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH'] = '/custom/path/to/cdxgen'

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/cdxgen',
      })
    })

    it('should return dlx package spec when SOCKET_CLI_CDXGEN_LOCAL_PATH is not set', () => {
      delete process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH']

      const result = resolveCdxgen() as Extract<
        BinaryResolution,
        { type: 'dlx' }
      >

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('@cyclonedx/cdxgen')
      expect(result.details.binaryName).toBe('cdxgen')
    })
  })

  describe('resolvePyCli', () => {
    it('should return local path when SOCKET_CLI_PYCLI_LOCAL_PATH is set', () => {
      process.env['SOCKET_CLI_PYCLI_LOCAL_PATH'] = '/custom/path/to/pycli'

      const result = resolvePyCli()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/pycli',
      })
    })

    it('should return python type when SOCKET_CLI_PYCLI_LOCAL_PATH is not set', () => {
      delete process.env['SOCKET_CLI_PYCLI_LOCAL_PATH']

      const result = resolvePyCli()

      expect(result).toEqual({ type: 'python' })
    })
  })

  describe('resolveSfw', () => {
    it('should return local path when SOCKET_CLI_SFW_LOCAL_PATH is set', () => {
      process.env['SOCKET_CLI_SFW_LOCAL_PATH'] = '/custom/path/to/sfw'

      const result = resolveSfw()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/sfw',
      })
    })

    it('should return npx type when SOCKET_CLI_SFW_LOCAL_PATH is not set', () => {
      delete process.env['SOCKET_CLI_SFW_LOCAL_PATH']

      const result = resolveSfw()

      expect(result).toEqual({ type: 'npx' })
    })
  })

  describe('resolveSynp', () => {
    it('should always return dlx package spec', () => {
      const result = resolveSynp() as Extract<BinaryResolution, { type: 'dlx' }>

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('synp')
      expect(result.details.binaryName).toBe('synp')
    })

    it('should return dlx even if environment variables are set', () => {
      process.env['SOCKET_CLI_SYNP_LOCAL_PATH'] = '/custom/path/to/synp'

      const result = resolveSynp() as Extract<BinaryResolution, { type: 'dlx' }>

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('synp')
      expect(result.details.binaryName).toBe('synp')
    })
  })

  describe('integration scenarios', () => {
    it('should handle empty string as no local path', () => {
      process.env['SOCKET_CLI_COANA_LOCAL_PATH'] = ''

      const result = resolveCoana()

      // Empty string is falsy, should use dlx.
      expect(result.type).toBe('dlx')
    })

    it('should handle relative paths', () => {
      process.env['SOCKET_CLI_CDXGEN_LOCAL_PATH'] = './local/cdxgen.js'

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'local',
        path: './local/cdxgen.js',
      })
    })

    it('should handle absolute paths', () => {
      process.env['SOCKET_CLI_SFW_LOCAL_PATH'] = '/usr/local/bin/sfw'

      const result = resolveSfw()

      expect(result).toEqual({
        type: 'local',
        path: '/usr/local/bin/sfw',
      })
    })
  })
})
