/**
 * Unit tests for organization policy license command.
 *
 * Tests the command that retrieves the license policy of an organization.
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
const mockHandleLicensePolicy = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock(
  '../../../../src/commands/organization/handle-license-policy.mts',
  () => ({
    handleLicensePolicy: mockHandleLicensePolicy,
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
const { cmdOrganizationPolicyLicense } =
  await import('../../../../src/commands/organization/cmd-organization-policy-license.mts')

describe('cmd-organization-policy-license', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganizationPolicyLicense.description).toBe(
        'Retrieve the license policy of an organization',
      )
    })

    it('should not be hidden', () => {
      expect(cmdOrganizationPolicyLicense.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = {
      url: 'file:///test/cmd-organization-policy-license.mts',
    }
    const context = { parentName: 'socket organization policy' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(['--dry-run'], importMeta, context)

      expect(mockHandleLicensePolicy).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdOrganizationPolicyLicense.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleLicensePolicy).not.toHaveBeenCalled()
    })

    it('should call handleLicensePolicy with valid token and text output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleLicensePolicy).toHaveBeenCalledWith('test-org', 'text')
    })

    it('should pass --org flag to determineOrgSlug', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--org', 'custom-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleLicensePolicy).toHaveBeenCalledWith('custom-org', 'text')
    })

    it('should pass --json flag to handleLicensePolicy', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleLicensePolicy).toHaveBeenCalledWith('test-org', 'json')
    })

    it('should pass --markdown flag to handleLicensePolicy', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleLicensePolicy).toHaveBeenCalledWith(
        'test-org',
        'markdown',
      )
    })

    it('should fail when both --json and --markdown flags are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--json', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleLicensePolicy).not.toHaveBeenCalled()
    })

    it('should show query parameters in dry-run mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(['--dry-run'], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DryRun]: Would fetch organization license policy',
        ),
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('organization: test-org'),
      )
    })

    it('should show undetermined org in dry-run mode when no org is available', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--dry-run', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('organization: (will be determined)'),
      )
    })

    it('should pass interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, false)
    })

    it('should pass no-interactive flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', false, false)
    })

    it('should handle custom org with interactive mode', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['my-org', 'my-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--org', 'my-org', '--interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('my-org', true, false)
      expect(mockHandleLicensePolicy).toHaveBeenCalledWith('my-org', 'text')
    })

    it('should pass dry-run flag to determineOrgSlug', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(['--dry-run'], importMeta, context)

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith('', true, true)
    })

    it('should combine org, json, and interactive flags correctly', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce([
        'combined-org',
        'combined-org',
      ])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdOrganizationPolicyLicense.run(
        ['--org', 'combined-org', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'combined-org',
        false,
        false,
      )
      expect(mockHandleLicensePolicy).toHaveBeenCalledWith(
        'combined-org',
        'json',
      )
    })
  })
})
