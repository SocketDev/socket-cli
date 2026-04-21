/**
 * Unit tests for scan delete command.
 *
 * Tests the command that deletes a scan.
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
const mockHandleDeleteScan = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/scan/handle-delete-scan.mts', () => ({
  handleDeleteScan: mockHandleDeleteScan,
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
const { cmdScanDel } =
  await import('../../../../src/commands/scan/cmd-scan-del.mts')

describe('cmd-scan-del', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanDel.description).toBe('Delete a scan')
    })

    it('should not be hidden', () => {
      expect(cmdScanDel.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-del.mts' }
    const context = { parentName: 'socket scan' }
    const testScanId = '000aaaa1-0000-0a0a-00a0-00a0000000a0'

    it('should support --dry-run flag', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockHandleDeleteScan).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteScan).not.toHaveBeenCalled()
    })

    it('should fail without scan ID', async () => {
      await cmdScanDel.run([], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteScan).not.toHaveBeenCalled()
    })

    it('should call handleDeleteScan with scan ID', async () => {
      await cmdScanDel.run([testScanId], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])

      await cmdScanDel.run(
        [testScanId, '--org', 'custom-org'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'custom-org',
        testScanId,
        'text',
      )
    })

    it('should support --json output mode', async () => {
      await cmdScanDel.run([testScanId, '--json'], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'json',
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdScanDel.run([testScanId, '--markdown'], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'markdown',
      )
    })

    it('should pass --no-interactive to determineOrgSlug', async () => {
      await cmdScanDel.run(
        [testScanId, '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should fail if org slug cannot be determined', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteScan).not.toHaveBeenCalled()
    })

    it('should show scan ID in dry-run', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(testScanId),
      )
    })

    it('should show organization in dry-run', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('test-org'),
      )
    })

    it('should show delete operation in dry-run', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/delet/i),
      )
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should default interactive to true', async () => {
      await cmdScanDel.run([testScanId], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should handle empty org flag as empty string', async () => {
      await cmdScanDel.run([testScanId, '--org', ''], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass correct command path context to handler', async () => {
      mockHandleDeleteScan.mockImplementationOnce(
        async (orgSlug, scanId, outputKind) => {
          expect(orgSlug).toBe('test-org')
          expect(scanId).toBe(testScanId)
          expect(outputKind).toBe('text')
        },
      )

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledTimes(1)
    })

    it('should support all common flags', async () => {
      await cmdScanDel.run(
        [testScanId, '--config', 'custom-config.json', '--no-spinner'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        'text',
      )
    })

    it('should call handler when all validations pass', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['valid-org', 'valid-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledTimes(1)
      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'valid-org',
        testScanId,
        'text',
      )
    })

    it('should not call handler in dry-run mode', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockHandleDeleteScan).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should use defaultOrgSlug nook behavior', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', 'default-org'])

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDeleteScan).not.toHaveBeenCalled()
    })

    it('should validate org slug even with default org', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['my-org', ''])

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'my-org',
        testScanId,
        'text',
      )
    })

    it('should format dry-run output with org/scan path', async () => {
      await cmdScanDel.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/test-org/),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(testScanId),
      )
    })

    it('should handle scan ID with different UUID format', async () => {
      const anotherScanId = '12345678-1234-5678-1234-567812345678'
      await cmdScanDel.run([anotherScanId], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'test-org',
        anotherScanId,
        'text',
      )
    })

    it('should handle org slug with special characters', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce([
        'org-with-dashes',
        'org-with-dashes',
      ])

      await cmdScanDel.run(
        [testScanId, '--org', 'org-with-dashes'],
        importMeta,
        context,
      )

      expect(mockHandleDeleteScan).toHaveBeenCalledWith(
        'org-with-dashes',
        testScanId,
        'text',
      )
    })

    it('should respect interactive flag in determineOrgSlug', async () => {
      await cmdScanDel.run([testScanId, '--interactive'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should not show API token error when token exists', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanDel.run([testScanId], importMeta, context)

      expect(mockHandleDeleteScan).toHaveBeenCalled()
    })
  })
})
