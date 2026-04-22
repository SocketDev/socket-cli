/**
 * Unit tests for scan reach command.
 *
 * Tests the command that computes tier 1 reachability analysis.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

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

vi.mock('../../../../src/commands/scan/handle-scan-reach.mts', () => ({
  handleScanReach: mockHandleScanReach,
}))

vi.mock('../../../../src/commands/scan/suggest_target.mts', () => ({
  suggestTarget: mockSuggestTarget,
}))

vi.mock(
  '../../../../src/commands/scan/validate-reachability-target.mts',
  () => ({
    validateReachabilityTarget: mockValidateReachabilityTarget,
  }),
)

vi.mock('../../../../src/utils/socket/org-slug.mts', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/socket/sdk.mts')
    >()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdScanReach } =
  await import('../../../../src/commands/scan/cmd-scan-reach.mts')

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
  })
})
