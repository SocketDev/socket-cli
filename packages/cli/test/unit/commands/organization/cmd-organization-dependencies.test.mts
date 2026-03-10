/**
 * Unit tests for organization dependencies command.
 *
 * Tests the command that searches for dependencies being used in an organization.
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
const mockHandleDependencies = vi.hoisted(() => vi.fn())
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock(
  '../../../../src/commands/organization/handle-dependencies.mts',
  () => ({
    handleDependencies: mockHandleDependencies,
  }),
)

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
const { cmdOrganizationDependencies } =
  await import('../../../../src/commands/organization/cmd-organization-dependencies.mts')

describe('cmd-organization-dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganizationDependencies.description).toBe(
        'Search for any dependency that is being used in your organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdOrganizationDependencies.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-organization-dependencies.mts' }
    const context = { parentName: 'socket organization' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(['--dry-run'], importMeta, context)

      expect(mockHandleDependencies).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdOrganizationDependencies.run([], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleDependencies).not.toHaveBeenCalled()
    })

    it('should call handleDependencies with default parameters', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run([], importMeta, context)

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
        outputKind: 'text',
      })
    })

    it('should pass --limit flag to handleDependencies', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(
        ['--limit', '20'],
        importMeta,
        context,
      )

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        outputKind: 'text',
      })
    })

    it('should pass --offset flag to handleDependencies', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(
        ['--offset', '10'],
        importMeta,
        context,
      )

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 50,
        offset: 10,
        outputKind: 'text',
      })
    })

    it('should pass both --limit and --offset flags', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(
        ['--limit', '20', '--offset', '10'],
        importMeta,
        context,
      )

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 20,
        offset: 10,
        outputKind: 'text',
      })
    })

    it('should pass --json flag to handleDependencies', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(['--json'], importMeta, context)

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
        outputKind: 'json',
      })
    })

    it('should pass --markdown flag to handleDependencies', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(['--markdown'], importMeta, context)

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
        outputKind: 'markdown',
      })
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(
        ['--json', '--markdown'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleDependencies).not.toHaveBeenCalled()
    })

    it('should validate negative limit value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdOrganizationDependencies.run(['--limit', '-1'], importMeta, context),
      ).rejects.toThrow('Invalid value for --limit: -1')

      expect(mockHandleDependencies).not.toHaveBeenCalled()
    })

    it('should validate negative offset value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdOrganizationDependencies.run(
          ['--offset', '-1'],
          importMeta,
          context,
        ),
      ).rejects.toThrow('Invalid value for --offset: -1')

      expect(mockHandleDependencies).not.toHaveBeenCalled()
    })

    it('should validate non-numeric limit value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdOrganizationDependencies.run(
          ['--limit', 'invalid'],
          importMeta,
          context,
        ),
      ).rejects.toThrow('Invalid value for --limit: invalid')

      expect(mockHandleDependencies).not.toHaveBeenCalled()
    })

    it('should validate non-numeric offset value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdOrganizationDependencies.run(
          ['--offset', 'invalid'],
          importMeta,
          context,
        ),
      ).rejects.toThrow('Invalid value for --offset: invalid')

      expect(mockHandleDependencies).not.toHaveBeenCalled()
    })

    it('should show query parameters in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(['--dry-run'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DryRun]: Would fetch organization dependencies',
        ),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('limit: 50'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('offset: 0'),
      )
    })

    it('should show custom query parameters in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(
        ['--dry-run', '--limit', '100', '--offset', '25'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('limit: 100'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('offset: 25'),
      )
    })

    it('should handle limit of zero by using default', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationDependencies.run(
        ['--limit', '0'],
        importMeta,
        context,
      )

      expect(mockHandleDependencies).toHaveBeenCalledWith({
        limit: 0,
        offset: 0,
        outputKind: 'text',
      })
    })
  })
})
