/**
 * Unit tests for dlx binary resolution.
 *
 * Purpose:
 * Tests binary resolution for dlx commands. Validates locating and selecting appropriate binaries.
 *
 * Test Coverage:
 * - Binary path resolution
 * - Local path override detection
 * - DLX package spec generation
 * - Fallback logic
 *
 * Testing Approach:
 * Uses vi.mock() to mock env modules since they export constants at module load time.
 *
 * Related Files:
 * - utils/dlx/resolve-binary.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BinaryResolution } from '../../../../src/utils/dlx/resolve-binary.mjs'

describe('resolve-binary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('resolveCoana', () => {
    it('should return local path when SOCKET_CLI_COANA_LOCAL_PATH is set', async () => {
      vi.doMock('../../../../src/env/socket-cli-coana-local-path.mts', () => ({
        SOCKET_CLI_COANA_LOCAL_PATH: '/custom/path/to/coana',
      }))

      const { resolveCoana } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/coana',
      })
    })

    it('should return dlx package spec when SOCKET_CLI_COANA_LOCAL_PATH is not set', async () => {
      vi.doMock('../../../../src/env/socket-cli-coana-local-path.mts', () => ({
        SOCKET_CLI_COANA_LOCAL_PATH: undefined,
      }))
      vi.doMock('../../../../src/env/coana-version.mts', () => ({
        getCoanaVersion: () => '1.0.0',
      }))

      const { resolveCoana } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveCoana() as Extract<
        BinaryResolution,
        { type: 'dlx' }
      >

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('@coana-tech/cli')
      expect(result.details.version).toBe('1.0.0')
      expect(result.details.binaryName).toBe('coana')
    })

    it('should prefer local path over dlx when both available', async () => {
      vi.doMock('../../../../src/env/socket-cli-coana-local-path.mts', () => ({
        SOCKET_CLI_COANA_LOCAL_PATH: '/local/coana',
      }))

      const { resolveCoana } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveCoana()

      expect(result).toEqual({
        type: 'local',
        path: '/local/coana',
      })
    })
  })

  describe('resolveCdxgen', () => {
    it('should return local path when SOCKET_CLI_CDXGEN_LOCAL_PATH is set', async () => {
      vi.doMock('../../../../src/env/socket-cli-cdxgen-local-path.mts', () => ({
        SOCKET_CLI_CDXGEN_LOCAL_PATH: '/custom/path/to/cdxgen',
      }))

      const { resolveCdxgen } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/cdxgen',
      })
    })

    it('should return dlx package spec when SOCKET_CLI_CDXGEN_LOCAL_PATH is not set', async () => {
      vi.doMock('../../../../src/env/socket-cli-cdxgen-local-path.mts', () => ({
        SOCKET_CLI_CDXGEN_LOCAL_PATH: undefined,
      }))
      vi.doMock('../../../../src/env/cdxgen-version.mts', () => ({
        getCdxgenVersion: () => '10.0.0',
      }))

      const { resolveCdxgen } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

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
    it('should return local path when SOCKET_CLI_PYCLI_LOCAL_PATH is set', async () => {
      vi.doMock('../../../../src/env/socket-cli-pycli-local-path.mts', () => ({
        SOCKET_CLI_PYCLI_LOCAL_PATH: '/custom/path/to/pycli',
      }))

      const { resolvePyCli } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolvePyCli()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/pycli',
      })
    })

    it('should return python type when SOCKET_CLI_PYCLI_LOCAL_PATH is not set', async () => {
      vi.doMock('../../../../src/env/socket-cli-pycli-local-path.mts', () => ({
        SOCKET_CLI_PYCLI_LOCAL_PATH: undefined,
      }))

      const { resolvePyCli } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolvePyCli()

      expect(result).toEqual({ type: 'python' })
    })
  })

  describe('resolveSfw', () => {
    it('should return local path when SOCKET_CLI_SFW_LOCAL_PATH is set', async () => {
      vi.doMock('../../../../src/env/socket-cli-sfw-local-path.mts', () => ({
        SOCKET_CLI_SFW_LOCAL_PATH: '/custom/path/to/sfw',
      }))

      const { resolveSfw } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveSfw()

      expect(result).toEqual({
        type: 'local',
        path: '/custom/path/to/sfw',
      })
    })

    it('should return dlx type when SOCKET_CLI_SFW_LOCAL_PATH is not set', async () => {
      vi.doMock('../../../../src/env/socket-cli-sfw-local-path.mts', () => ({
        SOCKET_CLI_SFW_LOCAL_PATH: undefined,
      }))
      vi.doMock('../../../../src/env/sfw-version.mts', () => ({
        getSwfVersion: () => '2.0.0',
      }))

      const { resolveSfw } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveSfw() as Extract<BinaryResolution, { type: 'dlx' }>

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('sfw')
      expect(result.details.binaryName).toBe('sfw')
      expect(result.details.version).toBe('2.0.0')
    })
  })

  describe('resolveSynp', () => {
    it('should always return dlx package spec', async () => {
      vi.doMock('../../../../src/env/synp-version.mts', () => ({
        getSynpVersion: () => '1.0.0',
      }))

      const { resolveSynp } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveSynp() as Extract<BinaryResolution, { type: 'dlx' }>

      expect(result.type).toBe('dlx')
      expect(result.details.name).toBe('synp')
      expect(result.details.binaryName).toBe('synp')
    })
  })

  describe('integration scenarios', () => {
    it('should handle empty string as no local path', async () => {
      vi.doMock('../../../../src/env/socket-cli-coana-local-path.mts', () => ({
        SOCKET_CLI_COANA_LOCAL_PATH: '',
      }))
      vi.doMock('../../../../src/env/coana-version.mts', () => ({
        getCoanaVersion: () => '1.0.0',
      }))

      const { resolveCoana } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveCoana()

      // Empty string is falsy, should use dlx.
      expect(result.type).toBe('dlx')
    })

    it('should handle relative paths', async () => {
      vi.doMock('../../../../src/env/socket-cli-cdxgen-local-path.mts', () => ({
        SOCKET_CLI_CDXGEN_LOCAL_PATH: './local/cdxgen.js',
      }))

      const { resolveCdxgen } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveCdxgen()

      expect(result).toEqual({
        type: 'local',
        path: './local/cdxgen.js',
      })
    })

    it('should handle absolute paths', async () => {
      vi.doMock('../../../../src/env/socket-cli-sfw-local-path.mts', () => ({
        SOCKET_CLI_SFW_LOCAL_PATH: '/usr/local/bin/sfw',
      }))

      const { resolveSfw } = await import(
        '../../../../src/utils/dlx/resolve-binary.mjs'
      )

      const result = resolveSfw()

      expect(result).toEqual({
        type: 'local',
        path: '/usr/local/bin/sfw',
      })
    })
  })
})
