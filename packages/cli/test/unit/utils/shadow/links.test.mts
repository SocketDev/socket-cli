import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installNpmLinks,
  installNpxLinks,
  installPnpmLinks,
  installYarnLinks,
} from '../../../../../src/utils/shadow/links.mts'

// Mock the dependencies.
vi.mock('cmd-shim', () => ({
  default: vi.fn(),
}))
vi.mock('@socketsecurity/lib/constants/platform', async () => {
  return {
    WIN32: false,
  }
})
vi.mock('../../../../../src/constants/paths.mts', () => ({
  getDistPath: vi.fn(() => '/socket-cli/dist'),
}))
vi.mock('../dlx/detection.mts', () => ({
  shouldSkipShadow: vi.fn(),
}))
vi.mock('../npm/paths.mts', () => ({
  getNpmBinPath: vi.fn(),
  getNpxBinPath: vi.fn(),
  isNpmBinPathShadowed: vi.fn(),
  isNpxBinPathShadowed: vi.fn(),
}))
vi.mock('../pnpm/paths.mts', () => ({
  getPnpmBinPath: vi.fn(),
  isPnpmBinPathShadowed: vi.fn(),
}))
vi.mock('../yarn/paths.mts', () => ({
  getYarnBinPath: vi.fn(),
  isYarnBinPathShadowed: vi.fn(),
}))

describe('shadow-links', () => {
  let originalPath: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    originalPath = process.env['PATH']
  })

  afterEach(() => {
    process.env['PATH'] = originalPath
  })

  describe('installNpmLinks', () => {
    it('should return bin path when shouldSkipShadow is true', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getNpmBinPath } = await import('../../../../../src/utils/npm/paths.mts')
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getNpmBinPath)

      mockGetBin.mockReturnValue('/usr/local/bin/npm')
      mockShouldSkip.mockReturnValue(true)

      const result = await installNpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npm')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should install shadow when not already shadowed', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getNpmBinPath, isNpmBinPathShadowed } = await import(
        '../npm/paths.mts'
      )
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getNpmBinPath)
      const mockIsShadowed = vi.mocked(isNpmBinPathShadowed)

      mockGetBin.mockReturnValue('/usr/local/bin/npm')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      const result = await installNpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npm')
      expect(process.env['PATH']).toMatch(/^\/shadow\/bin/)
    })

    it('should skip PATH modification when already shadowed', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getNpmBinPath, isNpmBinPathShadowed } = await import(
        '../npm/paths.mts'
      )
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getNpmBinPath)
      const mockIsShadowed = vi.mocked(isNpmBinPathShadowed)

      mockGetBin.mockReturnValue('/usr/local/bin/npm')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(true)

      const result = await installNpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npm')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should create cmd shim on Windows', async () => {
      const cmdShim = (await import('cmd-shim')).default
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getNpmBinPath, isNpmBinPathShadowed } = await import(
        '../npm/paths.mts'
      )
      const constants = await import('@socketsecurity/lib/constants/platform')
      const mockCmdShim = vi.mocked(cmdShim)
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getNpmBinPath)
      const mockIsShadowed = vi.mocked(isNpmBinPathShadowed)

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
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getNpxBinPath } = await import('../../../../../src/utils/npm/paths.mts')
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getNpxBinPath)

      mockGetBin.mockReturnValue('/usr/local/bin/npx')
      mockShouldSkip.mockReturnValue(true)

      const result = await installNpxLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npx')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should install shadow when not already shadowed', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getNpxBinPath, isNpxBinPathShadowed } = await import(
        '../npm/paths.mts'
      )
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getNpxBinPath)
      const mockIsShadowed = vi.mocked(isNpxBinPathShadowed)

      mockGetBin.mockReturnValue('/usr/local/bin/npx')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      const result = await installNpxLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/npx')
      expect(process.env['PATH']).toMatch(/^\/shadow\/bin/)
    })
  })

  describe('installPnpmLinks', () => {
    it('should return bin path when shouldSkipShadow is true', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getPnpmBinPath } = await import('../../../../../src/utils/pnpm/paths.mts')
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getPnpmBinPath)

      mockGetBin.mockReturnValue('/usr/local/bin/pnpm')
      mockShouldSkip.mockReturnValue(true)

      const result = await installPnpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/pnpm')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should install shadow when not already shadowed', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getPnpmBinPath, isPnpmBinPathShadowed } = await import(
        '../pnpm/paths.mts'
      )
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getPnpmBinPath)
      const mockIsShadowed = vi.mocked(isPnpmBinPathShadowed)

      mockGetBin.mockReturnValue('/usr/local/bin/pnpm')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      const result = await installPnpmLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/pnpm')
      expect(process.env['PATH']).toMatch(/^\/shadow\/bin/)
    })

    it('should create cmd shim on Windows', async () => {
      const cmdShim = (await import('cmd-shim')).default
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getPnpmBinPath, isPnpmBinPathShadowed } = await import(
        '../pnpm/paths.mts'
      )
      const constants = await import('@socketsecurity/lib/constants/platform')
      const mockCmdShim = vi.mocked(cmdShim)
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getPnpmBinPath)
      const mockIsShadowed = vi.mocked(isPnpmBinPathShadowed)

      // @ts-expect-error - Modifying mock constants.
      constants.WIN32 = true
      mockGetBin.mockReturnValue('C:\\pnpm\\pnpm.cmd')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      await installPnpmLinks('C:\\shadow\\bin')

      expect(mockCmdShim).toHaveBeenCalledWith(
        path.join('/socket-cli/dist', 'pnpm-cli.js'),
        path.join('C:\\shadow\\bin', 'pnpm'),
      )

      // @ts-expect-error - Reset mock constants.
      constants.WIN32 = false
    })
  })

  describe('installYarnLinks', () => {
    it('should return bin path when shouldSkipShadow is true', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getYarnBinPath } = await import('../../../../../src/utils/yarn/paths.mts')
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getYarnBinPath)

      mockGetBin.mockReturnValue('/usr/local/bin/yarn')
      mockShouldSkip.mockReturnValue(true)

      const result = await installYarnLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/yarn')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should install shadow when not already shadowed', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getYarnBinPath, isYarnBinPathShadowed } = await import(
        '../yarn/paths.mts'
      )
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getYarnBinPath)
      const mockIsShadowed = vi.mocked(isYarnBinPathShadowed)

      mockGetBin.mockReturnValue('/usr/local/bin/yarn')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      const result = await installYarnLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/yarn')
      expect(process.env['PATH']).toMatch(/^\/shadow\/bin/)
    })

    it('should skip PATH modification when already shadowed', async () => {
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getYarnBinPath, isYarnBinPathShadowed } = await import(
        '../yarn/paths.mts'
      )
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getYarnBinPath)
      const mockIsShadowed = vi.mocked(isYarnBinPathShadowed)

      mockGetBin.mockReturnValue('/usr/local/bin/yarn')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(true)

      const result = await installYarnLinks('/shadow/bin')

      expect(result).toBe('/usr/local/bin/yarn')
      expect(process.env['PATH']).toBe(originalPath)
    })

    it('should create cmd shim on Windows', async () => {
      const cmdShim = (await import('cmd-shim')).default
      const { shouldSkipShadow } = await import('../../../../../src/utils/dlx/detection.mts')
      const { getYarnBinPath, isYarnBinPathShadowed } = await import(
        '../yarn/paths.mts'
      )
      const constants = await import('@socketsecurity/lib/constants/platform')
      const mockCmdShim = vi.mocked(cmdShim)
      const mockShouldSkip = vi.mocked(shouldSkipShadow)
      const mockGetBin = vi.mocked(getYarnBinPath)
      const mockIsShadowed = vi.mocked(isYarnBinPathShadowed)

      // @ts-expect-error - Modifying mock constants.
      constants.WIN32 = true
      mockGetBin.mockReturnValue('C:\\yarn\\yarn.cmd')
      mockShouldSkip.mockReturnValue(false)
      mockIsShadowed.mockReturnValue(false)

      await installYarnLinks('C:\\shadow\\bin')

      expect(mockCmdShim).toHaveBeenCalledWith(
        path.join('/socket-cli/dist', 'yarn-cli.js'),
        path.join('C:\\shadow\\bin', 'yarn'),
      )

      // @ts-expect-error - Reset mock constants.
      constants.WIN32 = false
    })
  })
})
