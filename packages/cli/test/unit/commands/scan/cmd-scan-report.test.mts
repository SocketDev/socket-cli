/**
 * Unit tests for scan report command.
 *
 * Tests the command that checks scan results against organizational policies.
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
const mockHandleScanReport = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/scan/handle-scan-report.mts', () => ({
  handleScanReport: mockHandleScanReport,
}))

vi.mock('../../../../src/utils/socket/org-slug.mjs', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/socket/sdk.mjs')
    >()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdScanReport } = await import(
  '../../../../src/commands/scan/cmd-scan-report.mts'
)

describe('cmd-scan-report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanReport.description).toBe(
        'Check whether a scan result passes the organizational policies (security, license)',
      )
    })

    it('should not be hidden', () => {
      expect(cmdScanReport.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-report.mts' }
    const context = { parentName: 'socket scan' }
    const testScanId = '000aaaa1-0000-0a0a-00a0-00a0000000a0'

    it('should support --dry-run flag', async () => {
      await cmdScanReport.run(['--dry-run', testScanId], importMeta, context)

      expect(mockHandleScanReport).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanReport.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReport).not.toHaveBeenCalled()
    })

    it('should fail without scan ID', async () => {
      await cmdScanReport.run([], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReport).not.toHaveBeenCalled()
    })

    it('should call handleScanReport with scan ID', async () => {
      await cmdScanReport.run([testScanId], importMeta, context)

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'test-org',
          scanId: testScanId,
          includeLicensePolicy: false,
          outputKind: 'text',
          filepath: '',
          fold: 'none',
          short: false,
          reportLevel: 'warn',
        }),
      )
    })

    it('should pass --fold flag to handleScanReport', async () => {
      await cmdScanReport.run(
        [testScanId, '--fold', 'version'],
        importMeta,
        context,
      )

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          fold: 'version',
        }),
      )
    })

    it('should pass --report-level flag to handleScanReport', async () => {
      await cmdScanReport.run(
        [testScanId, '--report-level', 'error'],
        importMeta,
        context,
      )

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          reportLevel: 'error',
        }),
      )
    })

    it('should pass --short flag to handleScanReport', async () => {
      await cmdScanReport.run([testScanId, '--short'], importMeta, context)

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          short: true,
        }),
      )
    })

    it('should pass --license flag to handleScanReport', async () => {
      await cmdScanReport.run([testScanId, '--license'], importMeta, context)

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          includeLicensePolicy: true,
        }),
      )
    })

    it('should pass output file path to handleScanReport', async () => {
      await cmdScanReport.run(
        [testScanId, './output.json'],
        importMeta,
        context,
      )

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          filepath: './output.json',
        }),
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])

      await cmdScanReport.run(
        [testScanId, '--org', 'custom-org'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should support --json output mode', async () => {
      await cmdScanReport.run([testScanId, '--json'], importMeta, context)

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdScanReport.run([testScanId, '--markdown'], importMeta, context)

      expect(mockHandleScanReport).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail if both --json and --markdown are provided', async () => {
      await cmdScanReport.run(
        [testScanId, '--json', '--markdown'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReport).not.toHaveBeenCalled()
    })

    it('should pass --no-interactive to determineOrgSlug', async () => {
      await cmdScanReport.run(
        [testScanId, '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should fail if org slug cannot be determined', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])

      await cmdScanReport.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanReport).not.toHaveBeenCalled()
    })

    it('should show fold and report level in dry-run', async () => {
      await cmdScanReport.run(
        ['--dry-run', testScanId, '--fold', 'pkg', '--report-level', 'monitor'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('pkg'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('monitor'),
      )
    })

    it('should show license policy in dry-run', async () => {
      await cmdScanReport.run(
        ['--dry-run', testScanId, '--license'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('includeLicense'),
      )
    })

    it('should show short flag in dry-run', async () => {
      await cmdScanReport.run(
        ['--dry-run', testScanId, '--short'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('short'),
      )
    })
  })
})
