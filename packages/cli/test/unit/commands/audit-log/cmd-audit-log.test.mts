/**
 * Unit tests for audit-log command.
 *
 * Tests the command that displays organization audit logs.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - API token requirement validation
 * - Organization slug handling
 * - Type filter argument parsing
 * - Pagination flags: page, per-page
 * - Output modes: text, JSON, markdown
 * - Dry-run mode
 * - Legacy flag detection
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock handleAuditLog to verify handler invocation
 * - Mock determineOrgSlug for organization handling
 * - Mock hasDefaultApiToken for authentication checks
 * - Test flag combinations and defaults
 *
 * Related Files:
 * - src/commands/audit-log/cmd-audit-log.mts - Implementation
 * - src/commands/audit-log/handle-audit-log.mts - Handler
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
const mockHandleAuditLog = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../../../../src/commands/audit-log/handle-audit-log.mts', () => ({
  handleAuditLog: mockHandleAuditLog,
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
const { cmdAuditLog } =
  await import('../../../../src/commands/audit-log/cmd-audit-log.mts')

describe('cmd-audit-log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdAuditLog.description).toBe(
        'Look up the audit log for an organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdAuditLog.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-audit-log.mts' }
    const context = { parentName: 'socket' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--dry-run'], importMeta, context)

      expect(mockHandleAuditLog).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdAuditLog.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAuditLog).not.toHaveBeenCalled()
    })

    it('should call handleAuditLog with default values', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run([], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith({
        logType: '',
        orgSlug: 'test-org',
        outputKind: 'text',
        page: 0,
        perPage: 30,
      })
    })

    it('should pass type filter as first argument', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['deleteReport'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          logType: 'DeleteReport',
        }),
      )
    })

    it('should capitalize first letter of type filter', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['createApiToken'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          logType: 'CreateApiToken',
        }),
      )
    })

    it('should pass --page flag to handleAuditLog', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--page', '2'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
        }),
      )
    })

    it('should pass --per-page flag to handleAuditLog', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--per-page', '50'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          perPage: 50,
        }),
      )
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--org', 'custom-org'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        true,
        false,
      )
      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--json'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--markdown'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail if both --json and --markdown are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--json', '--markdown'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAuditLog).not.toHaveBeenCalled()
    })

    it('should fail without organization slug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAuditLog).not.toHaveBeenCalled()
    })

    it('should handle --no-interactive flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--no-interactive'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should validate type filter is alphabetic', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['invalid-123'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleAuditLog).not.toHaveBeenCalled()
    })

    it('should allow empty type filter', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run([], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          logType: '',
        }),
      )
    })

    it('should show dry-run output with all parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(
        ['--dry-run', 'deleteReport', '--page', '2', '--per-page', '10'],
        importMeta,
        context,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('audit log entries'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('deleteReport'),
      )
    })

    it('should validate page is numeric', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdAuditLog.run(['--page', 'invalid'], importMeta, context),
      ).rejects.toThrow(/--page must be a non-negative integer/)
    })

    it('should validate per-page is numeric', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdAuditLog.run(['--per-page', 'invalid'], importMeta, context),
      ).rejects.toThrow(/--per-page must be a non-negative integer/)
    })

    it('should reject negative page numbers', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdAuditLog.run(['--page', '-1'], importMeta, context),
      ).rejects.toThrow(/--page must be a non-negative integer/)
    })

    it('should reject negative per-page numbers', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdAuditLog.run(['--per-page', '-1'], importMeta, context),
      ).rejects.toThrow(/--per-page must be a non-negative integer/)
    })

    it('should accept zero as page number', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--page', '0'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 0,
        }),
      )
    })

    it('should combine type filter and pagination flags', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(
        ['sendInvitation', '--page', '3', '--per-page', '20'],
        importMeta,
        context,
      )

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          logType: 'SendInvitation',
          page: 3,
          perPage: 20,
        }),
      )
    })

    it('should show dry-run with default filter value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--dry-run'], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('any'),
      )
    })

    it('should handle organization with special characters', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce([
        'org-with-dash',
        'org-with-dash',
      ])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdAuditLog.run(['--org', 'org-with-dash'], importMeta, context)

      expect(mockHandleAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'org-with-dash',
        }),
      )
    })
  })
})
