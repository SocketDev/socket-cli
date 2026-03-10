/**
 * Unit tests for organization policy security command.
 *
 * Tests the command that retrieves the security policy of an organization.
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
const mockHandleSecurityPolicy = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock(
  '../../../../src/commands/organization/handle-security-policy.mts',
  () => ({
    handleSecurityPolicy: mockHandleSecurityPolicy,
  }),
)

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
const { cmdOrganizationPolicySecurity } =
  await import('../../../../src/commands/organization/cmd-organization-policy-security.mts')

describe('cmd-organization-policy-security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganizationPolicySecurity.description).toBe(
        'Retrieve the security policy of an organization',
      )
    })

    it('should be hidden', () => {
      expect(cmdOrganizationPolicySecurity.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = {
      url: 'file:///test/cmd-organization-policy-security.mts',
    }
    const context = { parentName: 'socket organization policy' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--dry-run'],
        importMeta,
        context,
      )

      expect(mockHandleSecurityPolicy).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdOrganizationPolicySecurity.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleSecurityPolicy).not.toHaveBeenCalled()
    })

    it('should call handleSecurityPolicy with valid token and text output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleSecurityPolicy).toHaveBeenCalledWith('test-org', 'text')
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleSecurityPolicy).toHaveBeenCalledWith(
        'custom-org',
        'text',
      )
    })

    it('should pass --json flag to handleSecurityPolicy', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleSecurityPolicy).toHaveBeenCalledWith('test-org', 'json')
    })

    it('should pass --markdown flag to handleSecurityPolicy', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleSecurityPolicy).toHaveBeenCalledWith(
        'test-org',
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleSecurityPolicy).not.toHaveBeenCalled()
    })

    it('should show query parameters in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--dry-run'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DryRun]: Would fetch organization security policy',
        ),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('organization: test-org'),
      )
    })

    it('should show undetermined org in dry-run mode when no org is available', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--dry-run', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('organization: (will be determined)'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass no-interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should handle custom org with interactive mode', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['my-org', 'my-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--org', 'my-org', '--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('my-org', true, false)
      expect(mockHandleSecurityPolicy).toHaveBeenCalledWith('my-org', 'text')
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--dry-run'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should combine org, json, and interactive flags correctly', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce([
        'combined-org',
        'combined-org',
      ])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicySecurity.run(
        ['--org', 'combined-org', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'combined-org',
        false,
        false,
      )
      expect(mockHandleSecurityPolicy).toHaveBeenCalledWith(
        'combined-org',
        'json',
      )
    })
  })
})
