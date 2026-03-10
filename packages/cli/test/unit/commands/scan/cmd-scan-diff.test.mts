/**
 * Unit tests for scan diff command.
 *
 * Tests the command that shows differences between two scans.
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
const mockHandleDiffScan = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/scan/handle-diff-scan.mts', () => ({
  handleDiffScan: mockHandleDiffScan,
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
const { cmdScanDiff } = await import(
  '../../../../src/commands/scan/cmd-scan-diff.mts'
)

describe('cmd-scan-diff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanDiff.description).toBe('See what changed between two Scans')
    })

    it('should not be hidden', () => {
      expect(cmdScanDiff.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-diff.mts' }
    const context = { parentName: 'socket scan' }
    const testScanId1 = 'aaa0aa0a-aaaa-0000-0a0a-0000000a00a0'
    const testScanId2 = 'aaa1aa1a-aaaa-1111-1a1a-1111111a11a1'

    it('should support --dry-run flag', async () => {
      await cmdScanDiff.run(
        ['--dry-run', testScanId1, testScanId2],
        importMeta,
        context,
      )

      expect(mockHandleDiffScan).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanDiff.run([testScanId1, testScanId2], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDiffScan).not.toHaveBeenCalled()
    })

    it('should fail without both scan IDs', async () => {
      await cmdScanDiff.run([], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDiffScan).not.toHaveBeenCalled()
    })

    it('should fail with only one scan ID', async () => {
      await cmdScanDiff.run([testScanId1], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDiffScan).not.toHaveBeenCalled()
    })

    it('should call handleDiffScan with two scan IDs', async () => {
      await cmdScanDiff.run([testScanId1, testScanId2], importMeta, context)

      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          id1: testScanId1,
          id2: testScanId2,
          depth: 2,
          orgSlug: 'test-org',
          outputKind: 'text',
          file: '',
        }),
      )
    })

    it('should pass --depth flag to handleDiffScan', async () => {
      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--depth', '5'],
        importMeta,
        context,
      )

      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          depth: 5,
        }),
      )
    })

    it('should pass --file flag to handleDiffScan', async () => {
      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--file', './diff.json'],
        importMeta,
        context,
      )

      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          file: './diff.json',
        }),
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])

      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--org', 'custom-org'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should support --json output mode', async () => {
      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--json'],
        importMeta,
        context,
      )

      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--markdown'],
        importMeta,
        context,
      )

      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail if both --json and --markdown are provided', async () => {
      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--json', '--markdown'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockHandleDiffScan).not.toHaveBeenCalled()
    })

    it('should pass --no-interactive to determineOrgSlug', async () => {
      await cmdScanDiff.run(
        [testScanId1, testScanId2, '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should fail if org slug cannot be determined', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])

      await cmdScanDiff.run([testScanId1, testScanId2], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleDiffScan).not.toHaveBeenCalled()
    })

    it('should extract scan ID from full Socket URL', async () => {
      const socketUrl1 = `https://socket.dev/dashboard/org/SocketDev/sbom/${testScanId1}`
      const socketUrl2 = `https://socket.dev/dashboard/org/SocketDev/sbom/${testScanId2}`

      await cmdScanDiff.run([socketUrl1, socketUrl2], importMeta, context)

      expect(mockHandleDiffScan).toHaveBeenCalledWith(
        expect.objectContaining({
          id1: testScanId1,
          id2: testScanId2,
        }),
      )
    })

    it('should show both scan IDs in dry-run', async () => {
      await cmdScanDiff.run(
        ['--dry-run', testScanId1, testScanId2],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(testScanId1),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(testScanId2),
      )
    })

    it('should show depth in dry-run', async () => {
      await cmdScanDiff.run(
        ['--dry-run', testScanId1, testScanId2, '--depth', '10'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('10'))
    })

    it('should show organization in dry-run', async () => {
      await cmdScanDiff.run(
        ['--dry-run', testScanId1, testScanId2],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('test-org'),
      )
    })
  })
})
