/**
 * Unit tests for scan list command.
 *
 * Tests the command that lists scans for an organization.
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
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock dependencies.
const mockHandleListScans = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/scan/handle-list-scans.mts', () => ({
  handleListScans: mockHandleListScans,
}))

vi.mock('../../../../src/utils/socket/org-slug.mjs', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/socket/sdk.mjs')>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdScanList } = await import(
  '../../../../src/commands/scan/cmd-scan-list.mts'
)

describe('cmd-scan-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanList.description).toBe('List the scans for an organization')
    })

    it('should not be hidden', () => {
      expect(cmdScanList.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-list.mts' }
    const context = { parentName: 'socket scan' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--dry-run', '--org', 'test-org'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should show query parameters in --dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        [
          '--dry-run',
          '--org', 'test-org',
          '--page', '2',
          '--per-page', '50',
          '--sort', 'name',
          '--direction', 'asc',
        ],
        importMeta,
        context,
      )

      expect(mockHandleListScans).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Query parameters'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('page: 2'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('perPage: 50'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanList.run(
        ['--org', 'test-org'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListScans).not.toHaveBeenCalled()
    })

    it('should call handleListScans with valid inputs', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: '',
          direction: 'desc',
          from_time: '',
          orgSlug: 'test-org',
          outputKind: 'text',
          page: 1,
          perPage: 30,
          repo: '',
          sort: 'created_at',
        }),
      )
    })

    it('should pass --org flag to handleListScans', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'custom-org'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('custom-org', true, false)
      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should pass --page flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--page', '3'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 3,
        }),
      )
    })

    it('should pass --per-page flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--per-page', '50'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          perPage: 50,
        }),
      )
    })

    it('should pass --sort flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--sort', 'name'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: 'name',
        }),
      )
    })

    it('should pass --direction flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--direction', 'asc'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'asc',
        }),
      )
    })

    it('should pass --branch flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--branch', 'develop'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: 'develop',
        }),
      )
    })

    it('should pass --from-time flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--from-time', '1234567890'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          from_time: '1234567890',
        }),
      )
    })

    it('should pass --until-time flag to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--until-time', '9876543210'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalled()
    })

    it('should accept repo as positional argument', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', 'my-repo'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'my-repo',
        }),
      )
    })

    it('should accept branch as second positional argument', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', 'my-repo', 'develop'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'my-repo',
          branch: 'develop',
        }),
      )
    })

    it('should fail when both --branch flag and branch argument are provided', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--branch', 'main', 'my-repo', 'develop'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListScans).not.toHaveBeenCalled()
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--json'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--markdown'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail when both --json and --markdown are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleListScans).not.toHaveBeenCalled()
    })


    it('should use default pagination values', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          perPage: 30,
        }),
      )
    })

    it('should use default sort and direction', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: 'created_at',
          direction: 'desc',
        }),
      )
    })

    it('should combine multiple filter flags', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        [
          '--org', 'test-org',
          'my-repo',
          '--branch', 'main',
          '--page', '2',
          '--per-page', '25',
          '--sort', 'created_at',
          '--direction', 'asc',
        ],
        importMeta,
        context,
      )

      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'my-repo',
          branch: 'main',
          page: 2,
          perPage: 25,
          sort: 'created_at',
          direction: 'asc',
        }),
      )
    })

    it('should support --no-interactive flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('test-org', false, false)
      expect(mockHandleListScans).toHaveBeenCalled()
    })
  })
})
