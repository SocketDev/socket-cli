/**
 * Unit tests for scan reach command numeric validation and miscellaneous
 * flag behavior.
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

    it('should validate invalid numeric values for memory limit', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanReach.run(
          [
            '--org',
            'test-org',
            '--reach-analysis-memory-limit',
            'invalid',
            '.',
          ],
          importMeta,
          context,
        ),
      ).rejects.toThrow(
        /--reach-analysis-memory-limit must be a number of megabytes/,
      )
    })

    it('should validate invalid numeric values for timeout', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanReach.run(
          ['--org', 'test-org', '--reach-analysis-timeout', 'invalid', '.'],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/--reach-analysis-timeout must be a number of seconds/)
    })

    it('should validate invalid numeric values for concurrency', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanReach.run(
          ['--org', 'test-org', '--reach-concurrency', 'invalid', '.'],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/--reach-concurrency must be a positive integer/)
    })

    it('should default to current directory if no target specified', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(['--org', 'test-org'], importMeta, context)

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: [expect.any(String)],
        }),
      )
    })

    it('should support --no-interactive flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--no-interactive', '.'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'test-org',
        false,
        false,
      )
      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          interactive: false,
        }),
      )
    })

    it('should pass --cwd flag to change working directory', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--cwd', './my-project', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('my-project'),
        }),
      )
    })

    it('should combine multiple reachability flags', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        [
          '--org',
          'test-org',
          '--reach-ecosystems',
          'npm',
          '--reach-concurrency',
          '2',
          '--reach-debug',
          '--reach-lazy-mode',
          '--reach-skip-cache',
          '--reach-min-severity',
          'medium',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachEcosystems: ['npm'],
            reachConcurrency: 2,
            reachDebug: true,
            reachLazyMode: true,
            reachSkipCache: true,
            reachMinSeverity: 'medium',
          }),
        }),
      )
    })

    it('emits --ecosystems in dry-run args when reachEcosystems set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        [
          '--org',
          'test-org',
          '--reach-ecosystems',
          'npm,pypi',
          '--dry-run',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('--ecosystems'),
      )
    })
  })
})
