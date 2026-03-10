/**
 * Unit tests for scan metadata command.
 *
 * Tests the command that retrieves scan metadata.
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
const mockHandleOrgScanMetadata = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/scan/handle-scan-metadata.mts', () => ({
  handleOrgScanMetadata: mockHandleOrgScanMetadata,
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
const { cmdScanMetadata } =
  await import('../../../../src/commands/scan/cmd-scan-metadata.mts')

describe('cmd-scan-metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanMetadata.description).toBe("Get a scan's metadata")
    })

    it('should not be hidden', () => {
      expect(cmdScanMetadata.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-metadata.mts' }
    const context = { parentName: 'socket scan' }
    const testScanId = '000aaaa1-0000-0a0a-00a0-00a0000000a0'

    it('should support --dry-run flag', async () => {
      await cmdScanMetadata.run(['--dry-run', testScanId], importMeta, context)

      expect(mockHandleOrgScanMetadata).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanMetadata.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleOrgScanMetadata).not.toHaveBeenCalled()
    })

    it('should fail without scan ID', async () => {
      await cmdScanMetadata.run([], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleOrgScanMetadata).not.toHaveBeenCalled()
    })

    it('should call handleOrgScanMetadata with scan ID', async () => {
      await cmdScanMetadata.run([testScanId], importMeta, context)

      expect(mockHandleOrgScanMetadata).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])

      await cmdScanMetadata.run(
        [testScanId, '--org', 'custom-org'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleOrgScanMetadata).toHaveBeenCalledWith(
        'custom-org',
        testScanId,
        'text',
      )
    })

    it('should support --json output mode', async () => {
      await cmdScanMetadata.run([testScanId, '--json'], importMeta, context)

      expect(mockHandleOrgScanMetadata).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'json',
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdScanMetadata.run([testScanId, '--markdown'], importMeta, context)

      expect(mockHandleOrgScanMetadata).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'markdown',
      )
    })

    it('should fail if both --json and --markdown are provided', async () => {
      await cmdScanMetadata.run(
        [testScanId, '--json', '--markdown'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockHandleOrgScanMetadata).not.toHaveBeenCalled()
    })

    it('should pass --no-interactive to determineOrgSlug', async () => {
      await cmdScanMetadata.run(
        [testScanId, '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should fail if org slug cannot be determined', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])

      await cmdScanMetadata.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleOrgScanMetadata).not.toHaveBeenCalled()
    })

    it('should show scan ID in dry-run', async () => {
      await cmdScanMetadata.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(testScanId),
      )
    })

    it('should show organization in dry-run', async () => {
      await cmdScanMetadata.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('test-org'),
      )
    })

    it('should show metadata operation in dry-run', async () => {
      await cmdScanMetadata.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringMatching(/metadata/i),
      )
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      await cmdScanMetadata.run(['--dry-run', testScanId], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should default interactive to true', async () => {
      await cmdScanMetadata.run([testScanId], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should handle empty org flag as empty string', async () => {
      await cmdScanMetadata.run([testScanId, '--org', ''], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass correct command path context to handler', async () => {
      mockHandleOrgScanMetadata.mockImplementationOnce(
        async (orgSlug, scanId, outputKind) => {
          expect(orgSlug).toBe('test-org')
          expect(scanId).toBe(testScanId)
          expect(outputKind).toBe('text')
        },
      )

      await cmdScanMetadata.run([testScanId], importMeta, context)

      expect(mockHandleOrgScanMetadata).toHaveBeenCalledTimes(1)
    })

    it('should support all common flags', async () => {
      await cmdScanMetadata.run(
        [testScanId, '--config', 'custom-config.json', '--no-spinner'],
        importMeta,
        context,
      )

      expect(mockHandleOrgScanMetadata).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'text',
      )
    })

    it('should call handler when all validations pass', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['valid-org', 'valid-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanMetadata.run([testScanId], importMeta, context)

      expect(mockHandleOrgScanMetadata).toHaveBeenCalledTimes(1)
      expect(mockHandleOrgScanMetadata).toHaveBeenCalledWith(
        'valid-org',
        testScanId,
        'text',
      )
    })

    it('should not call handler in dry-run mode', async () => {
      await cmdScanMetadata.run(['--dry-run', testScanId], importMeta, context)

      expect(mockHandleOrgScanMetadata).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalled()
    })
  })
})
