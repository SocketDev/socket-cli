/**
 * Unit tests for organization list command.
 *
 * Tests the command that lists organizations associated with the Socket API token.
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
const mockHandleOrganizationList = vi.hoisted(() => vi.fn())
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/organization/handle-organization-list.mts', () => ({
  handleOrganizationList: mockHandleOrganizationList,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/socket/sdk.mjs')>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

// Import after mocks.
const { cmdOrganizationList } = await import(
  '../../../../src/commands/organization/cmd-organization-list.mts'
)

describe('cmd-organization-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganizationList.description).toBe('List organizations associated with the Socket API token')
    })

    it('should not be hidden', () => {
      expect(cmdOrganizationList.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-organization-list.mts' }
    const context = { parentName: 'socket organization' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationList.run(
        ['--dry-run'],
        importMeta,
        context,
      )

      expect(mockHandleOrganizationList).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdOrganizationList.run(
        [],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleOrganizationList).not.toHaveBeenCalled()
    })

    it('should call handleOrganizationList with valid token and text output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationList.run(
        [],
        importMeta,
        context,
      )

      expect(mockHandleOrganizationList).toHaveBeenCalledWith('text')
    })

    it('should pass --json flag to handleOrganizationList', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationList.run(
        ['--json'],
        importMeta,
        context,
      )

      expect(mockHandleOrganizationList).toHaveBeenCalledWith('json')
    })

    it('should pass --markdown flag to handleOrganizationList', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationList.run(
        ['--markdown'],
        importMeta,
        context,
      )

      expect(mockHandleOrganizationList).toHaveBeenCalledWith('markdown')
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationList.run(
        ['--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleOrganizationList).not.toHaveBeenCalled()
    })

    it('should show query parameters in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationList.run(
        ['--dry-run'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('[DryRun]: Would fetch organizations'),
      )
    })
  })
})
