/**
 * Unit tests for organization quota command.
 *
 * Tests the command that lists organizations associated with the Socket API token
 * and displays quota information.
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
const mockHandleQuota = vi.hoisted(() => vi.fn())
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/organization/handle-quota.mts', () => ({
  handleQuota: mockHandleQuota,
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
const { cmdOrganizationQuota } =
  await import('../../../../src/commands/organization/cmd-organization-quota.mts')

describe('cmd-organization-quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganizationQuota.description).toBe(
        'Show remaining Socket API quota for the current token, plus refresh window',
      )
    })

    it('should not be hidden', () => {
      expect(cmdOrganizationQuota.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-organization-quota.mts' }
    const context = { parentName: 'socket organization' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run(['--dry-run'], importMeta, context)

      expect(mockHandleQuota).not.toHaveBeenCalled()
      // Dry-run previews are contextual output; they route to stderr per
      // the stream discipline rule so stdout stays payload-only.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('organization quota'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdOrganizationQuota.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleQuota).not.toHaveBeenCalled()
    })

    it('should call handleQuota with default text output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run([], importMeta, context)

      expect(mockHandleQuota).toHaveBeenCalledWith('text')
    })

    it('should pass --json flag to handleQuota', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run(['--json'], importMeta, context)

      expect(mockHandleQuota).toHaveBeenCalledWith('json')
    })

    it('should pass --markdown flag to handleQuota', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run(['--markdown'], importMeta, context)

      expect(mockHandleQuota).toHaveBeenCalledWith('markdown')
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run(
        ['--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleQuota).not.toHaveBeenCalled()
    })

    it('should validate input even without API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdOrganizationQuota.run(
        ['--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleQuota).not.toHaveBeenCalled()
    })

    it('should not call handleQuota in dry-run mode even with valid token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run(
        ['--dry-run', '--json'],
        importMeta,
        context,
      )

      expect(mockHandleQuota).not.toHaveBeenCalled()
      // With --json, dry-run output routes to stderr so stdout stays
      // pipe-safe for JSON consumers.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[DryRun]'),
      )
    })

    it('should handle readonly argv array', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      const readonlyArgv: readonly string[] = ['--json']
      await cmdOrganizationQuota.run(readonlyArgv, importMeta, context)

      expect(mockHandleQuota).toHaveBeenCalledWith('json')
    })

    it('should handle empty flags and use text output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationQuota.run([], importMeta, context)

      expect(mockHandleQuota).toHaveBeenCalledWith('text')
    })
  })
})
