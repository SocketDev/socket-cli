/**
 * Unit tests for scan reach command.
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

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanReach.description).toBe('Compute tier 1 reachability')
    })

    it('should be hidden', () => {
      expect(cmdScanReach.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-reach.mts' }
    const context = { parentName: 'socket scan' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--dry-run', '--org', 'test-org', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should show command and args in --dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--dry-run', '--org', 'test-org', './my-project'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Command: coana'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanReach.run(['--org', 'test-org', '.'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReach).not.toHaveBeenCalled()
    })

    it('should call handleScanReach with valid inputs', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(['--org', 'test-org', '.'], importMeta, context)

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.any(String),
          interactive: true,
          orgSlug: 'test-org',
          outputKind: 'text',
          targets: ['.'],
          reachabilityOptions: expect.any(Object),
        }),
      )
    })

    it('should pass --org flag to handleScanReach', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(['--org', 'custom-org', '.'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should validate target must be exactly one directory', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: true,
        isInsideCwd: true,
        isValid: false,
        targetExists: true,
      })

      await cmdScanReach.run(
        ['--org', 'test-org', './dir1', './dir2'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReach).not.toHaveBeenCalled()
    })

    it('should validate target must be a directory', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: false,
        isInsideCwd: true,
        isValid: true,
        targetExists: true,
      })

      await cmdScanReach.run(
        ['--org', 'test-org', './package.json'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReach).not.toHaveBeenCalled()
    })

    it('should validate target must exist', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: true,
        isInsideCwd: true,
        isValid: true,
        targetExists: false,
      })

      await cmdScanReach.run(
        ['--org', 'test-org', './nonexistent'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReach).not.toHaveBeenCalled()
    })

    it('should validate target must be inside cwd', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: true,
        isInsideCwd: false,
        isValid: true,
        targetExists: true,
      })

      await cmdScanReach.run(
        ['--org', 'test-org', '../outside'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReach).not.toHaveBeenCalled()
    })

    it('should pass reachability options to handleScanReach', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        [
          '--org',
          'test-org',
          '--reach-ecosystems',
          'npm,pypi',
          '--reach-concurrency',
          '4',
          '--reach-debug',
          '.',
        ],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          reachabilityOptions: expect.objectContaining({
            reachConcurrency: 4,
            reachDebug: true,
            reachEcosystems: ['npm', 'pypi'],
          }),
        }),
      )
    })

    it('should validate invalid ecosystem value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanReach.run(
          ['--org', 'test-org', '--reach-ecosystems', 'invalid-ecosystem', '.'],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/--reach-ecosystems must be one of/)
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--json', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--markdown', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanReach).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail when both --json and --markdown are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanReach.run(
        ['--org', 'test-org', '--json', '--markdown', '.'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReach).not.toHaveBeenCalled()
    })
  })
})
