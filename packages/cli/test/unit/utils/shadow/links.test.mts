/**
 * Unit tests for shadow realm link utilities.
 *
 * Purpose:
 * Tests shadow realm symlink utilities. Validates shadow installation link management.
 *
 * Test Coverage:
 * - Symlink creation
 * - Symlink validation
 * - Link cleanup
 * - Broken link detection
 * - Cross-platform link handling
 *
 * Testing Approach:
 * Tests shadow realm symlink utilities for optimized installations.
 *
 * Related Files:
 * - utils/shadow/links.mts (implementation)
 */

import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installNpmLinks,
  installNpxLinks,
} from '../../../../src/utils/shadow/links.mts'

// Mock the dependencies.
const mockDefault = vi.hoisted(() => vi.fn())
const mockGetDistPath = vi.hoisted(() => vi.fn())
const mockShouldSkipShadow = vi.hoisted(() => vi.fn())
const mockGetNpmBinPath = vi.hoisted(() => vi.fn())
const mockGetNpxBinPath = vi.hoisted(() => vi.fn())
const mockIsNpmBinPathShadowed = vi.hoisted(() => vi.fn())
const mockIsNpxBinPathShadowed = vi.hoisted(() => vi.fn())
vi.mock('cmd-shim', () => ({
  default: mockDefault,
}))
vi.mock('@socketsecurity/lib/constants/platform', async () => {
  return {
    WIN32: false,
  }
})
vi.mock('../../../../src/constants/paths.mts', () => ({
  getDistPath: mockGetDistPath,
}))
vi.mock('../../../../src/utils/dlx/detection.mts', () => ({
  shouldSkipShadow: mockShouldSkipShadow,
}))
vi.mock('../../../../src/utils/npm/paths.mts', () => ({
  getNpmBinPath: mockGetNpmBinPath,
  getNpxBinPath: mockGetNpxBinPath,
  isNpmBinPathShadowed: mockIsNpmBinPathShadowed,
  isNpxBinPathShadowed: mockIsNpxBinPathShadowed,
}))

describe('shadow-links', () => {
  let originalPath: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalPath = process.env['PATH']
    mockGetDistPath.mockReturnValue('/socket-cli/dist')
  })

  afterEach(() => {
    process.env['PATH'] = originalPath
  })

  describe('installNpmLinks', () => {
    it('should return bin path when shouldSkipShadow is true', async () => {
      const mockShouldSkip = mockShouldSkipShadow
      const mockGetBin = mockGetNpmBinPath

      mockGetBin.mockReturnValue('/usr/local/bin/npm')
      mockShouldSkip.mockReturnValue(true)

      const result = await installNpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npm')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should install shadow when not already shadowed', async () => {
      const mockShouldSkip = mockShouldSkipShadow
      const mockGetBin = mockGetNpmBinPath
      const mockIsShadowed = mockIsNpmBinPathShadowed

      mockGetBin.mockReturnValue('/usr/local/bin/npm')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      const result = await installNpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npm')
      expect(process.env['PATH']).toMatch(/^\/shadow\/bin/)
    })

    it('should skip PATH modification when already shadowed', async () => {
      const mockShouldSkip = mockShouldSkipShadow
      const mockGetBin = mockGetNpmBinPath
      const mockIsShadowed = mockIsNpmBinPathShadowed

      mockGetBin.mockReturnValue('/usr/local/bin/npm')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(true)

      const result = await installNpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npm')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should create cmd shim on Windows', async () => {
      const cmdShim = (await import('cmd-shim')).default
      const constants = await import('@socketsecurity/lib/constants/platform')
      const mockCmdShim = vi.mocked(cmdShim)
      const mockShouldSkip = mockShouldSkipShadow
      const mockGetBin = mockGetNpmBinPath
      const mockIsShadowed = mockIsNpmBinPathShadowed

      // @ts-expect-error - Modifying mock constants.
      constants.WIN32 = true
      mockGetBin.mockReturnValue('C:\\npm\\npm.cmd')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      await installNpmLinks('C:\\shadow\\bin')

      expect(mockCmdShim).toHaveBeenCalledWith(
        path.join('/socket-cli/dist', 'npm-cli.js'),
        path.join('C:\\shadow\\bin', 'npm'),
      )

      // @ts-expect-error - Reset mock constants.
      constants.WIN32 = false
    })
  })

  describe('installNpxLinks', () => {
    it('should return bin path when shouldSkipShadow is true', async () => {
      const mockShouldSkip = mockShouldSkipShadow
      const mockGetBin = mockGetNpxBinPath

      mockGetBin.mockReturnValue('/usr/local/bin/npx')
      mockShouldSkip.mockReturnValue(true)

      const result = await installNpxLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npx')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should install shadow when not already shadowed', async () => {
      const mockShouldSkip = mockShouldSkipShadow
      const mockGetBin = mockGetNpxBinPath
      const mockIsShadowed = mockIsNpxBinPathShadowed

      mockGetBin.mockReturnValue('/usr/local/bin/npx')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      const result = await installNpxLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npx')
      expect(process.env['PATH']).toMatch(/^\/shadow\/bin/)
    })
  })

  // Note: pnpm and yarn no longer use shadow binaries.
  // They now delegate directly to Socket Firewall (sfw) via dlx.
  // Only npm/npx still use shadow binaries for legacy compatibility.
})
