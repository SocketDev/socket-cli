/**
 * Unit tests for scan view command.
 *
 * Tests the command that views raw scan results.
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
const mockHandleScanView = vi.hoisted(() => vi.fn())
const mockStreamScan = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/scan/handle-scan-view.mts', () => ({
  handleScanView: mockHandleScanView,
}))

vi.mock('../../../../src/commands/scan/stream-scan.mts', () => ({
  streamScan: mockStreamScan,
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
const { cmdScanView } = await import(
  '../../../../src/commands/scan/cmd-scan-view.mts'
)

describe('cmd-scan-view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanView.description).toBe('View the raw results of a scan')
    })

    it('should not be hidden', () => {
      expect(cmdScanView.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-view.mts' }
    const context = { parentName: 'socket scan' }
    const testScanId = '000aaaa1-0000-0a0a-00a0-00a0000000a0'

    it('should support --dry-run flag', async () => {
      await cmdScanView.run(['--dry-run', testScanId], importMeta, context)

      expect(mockHandleScanView).not.toHaveBeenCalled()
      expect(mockStreamScan).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanView.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanView).not.toHaveBeenCalled()
    })

    it('should fail without scan ID', async () => {
      await cmdScanView.run([], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanView).not.toHaveBeenCalled()
    })

    it('should call handleScanView with scan ID', async () => {
      await cmdScanView.run([testScanId], importMeta, context)

      expect(mockHandleScanView).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        '',
        'text',
      )
    })

    it('should pass output file path to handleScanView', async () => {
      await cmdScanView.run([testScanId, './output.json'], importMeta, context)

      expect(mockHandleScanView).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        './output.json',
        'text',
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])

      await cmdScanView.run(
        [testScanId, '--org', 'custom-org'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleScanView).toHaveBeenCalledWith(
        'custom-org',
        testScanId,
        '',
        'text',
      )
    })

    it('should support --json output mode', async () => {
      await cmdScanView.run([testScanId, '--json'], importMeta, context)

      expect(mockHandleScanView).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        '',
        'json',
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdScanView.run([testScanId, '--markdown'], importMeta, context)

      expect(mockHandleScanView).toHaveBeenCalledWith(
        'test-org',
        testScanId,
        '',
        'markdown',
      )
    })

    it('should fail if both --json and --markdown are provided', async () => {
      await cmdScanView.run(
        [testScanId, '--json', '--markdown'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanView).not.toHaveBeenCalled()
    })

    it('should call streamScan with --json --stream flags', async () => {
      await cmdScanView.run(
        [testScanId, '--json', '--stream'],
        importMeta,
        context,
      )

      expect(mockStreamScan).toHaveBeenCalledWith('test-org', testScanId, {
        commandPath: 'socket scan view',
        file: '',
      })
      expect(mockHandleScanView).not.toHaveBeenCalled()
    })

    it('should pass file to streamScan with --json --stream', async () => {
      await cmdScanView.run(
        [testScanId, './stream.txt', '--json', '--stream'],
        importMeta,
        context,
      )

      expect(mockStreamScan).toHaveBeenCalledWith('test-org', testScanId, {
        commandPath: 'socket scan view',
        file: './stream.txt',
      })
    })

    it('should fail if --stream is used without --json', async () => {
      await cmdScanView.run([testScanId, '--stream'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanView).not.toHaveBeenCalled()
      expect(mockStreamScan).not.toHaveBeenCalled()
    })

    it('should pass --no-interactive to determineOrgSlug', async () => {
      await cmdScanView.run(
        [testScanId, '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should fail if org slug cannot be determined', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])

      await cmdScanView.run([testScanId], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleScanView).not.toHaveBeenCalled()
    })

    it('should show scan ID in dry-run', async () => {
      await cmdScanView.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(testScanId),
      )
    })

    it('should show organization in dry-run', async () => {
      await cmdScanView.run(['--dry-run', testScanId], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('test-org'),
      )
    })

    it('should show stream mode in dry-run with --json --stream', async () => {
      await cmdScanView.run(
        ['--dry-run', testScanId, '--json', '--stream'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('stream'),
      )
    })
  })
})
