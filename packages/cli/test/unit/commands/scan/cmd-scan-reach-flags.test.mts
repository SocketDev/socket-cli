/**
 * Unit tests for scan reach command reach-* flag pass-through.
 *
 * Tests the command that computes tier 1 reachability analysis.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdScanReach } from '../../../../src/commands/scan/cmd-scan-reach.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'
import type * as SdkModule from '../../../../src/util/socket/sdk.mts'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

// Mock dependencies.
const mockHandleScanReach = vi.hoisted(() => vi.fn())
const mockSuggestTarget = vi.hoisted(() => vi.fn().mockResolvedValue(['.']))
const mockValidateReachabilityTarget = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    isDirectory: true,
    isInsideCwd: true,
    isValid: true,
    targetExists: true,
  }),
)
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock(import('../../../../src/commands/scan/handle-scan-reach.mts'), () => ({
  handleScanReach: mockHandleScanReach,
}))

vi.mock(import('../../../../src/commands/scan/suggest_target.mts'), () => ({
  suggestTarget: mockSuggestTarget,
}))

vi.mock(
  import('../../../../src/commands/scan/validate-reachability-target.mts'),
  () => ({
    validateReachabilityTarget: mockValidateReachabilityTarget,
  }),
)

vi.mock(import('../../../../src/util/socket/org-slug.mts'), () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock(import('../../../../src/util/socket/sdk.mts'), async importOriginal => {
  const actual = await importOriginal<typeof SdkModule>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

describe('cmd-scan-reach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-reach.mts' }
    const context = { parentName: 'socket scan' }

    it('should pass --reach-analysis-memory-limit flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-analysis-memory-limit', '4096', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachAnalysisMemoryLimit: 4096,
          }),
        }),
      )
    })

    it('should pass --reach-analysis-timeout flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-analysis-timeout', '300', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachAnalysisTimeout: 300,
          }),
        }),
      )
    })

    it('should pass --reach-lazy-mode flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-lazy-mode', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachLazyMode: true,
          }),
        }),
      )
    })

    it('should pass --reach-skip-cache flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-skip-cache', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachSkipCache: true,
          }),
        }),
      )
    })

    it('should pass --reach-disable-analytics flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-disable-analytics', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachDisableAnalytics: true,
          }),
        }),
      )
    })

    it('should pass --reach-enable-analysis-splitting flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-enable-analysis-splitting', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachEnableAnalysisSplitting: true,
          }),
        }),
      )
    })

    it('should pass --reach-min-severity flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-min-severity', 'high', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachMinSeverity: 'high',
          }),
        }),
      )
    })

    it('should pass --reach-exclude-paths flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        [
          '--org',
          'test-org',
          '--reach-exclude-paths',
          'node_modules,dist',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachExcludePaths: expect.arrayContaining(['node_modules', 'dist']),
          }),
        }),
      )
    })

    it('should pass --reach-use-only-pregenerated-sboms flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--reach-use-only-pregenerated-sboms', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachUseOnlyPregeneratedSboms: true,
          }),
        }),
      )
    })

    it('should pass --reach-use-unreachable-from-precomputation flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        [
          '--org',
          'test-org',
          '--reach-use-unreachable-from-precomputation',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachUseUnreachableFromPrecomputation: true,
          }),
        }),
      )
    })
  })
})
