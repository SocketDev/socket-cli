/**
 * Unit tests for organization policy parent command.
 *
 * Tests the parent command that routes to organization policy subcommands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockMeowWithSubcommands = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/cli/with-subcommands.mts', () => ({
  meowWithSubcommands: mockMeowWithSubcommands,
}))

// Import after mocks.
const { cmdOrganizationPolicy } =
  await import('../../../../src/commands/organization/cmd-organization-policy.mts')
const { cmdOrganizationPolicyLicense } =
  await import('../../../../src/commands/organization/cmd-organization-policy-license.mts')
const { cmdOrganizationPolicySecurity } =
  await import('../../../../src/commands/organization/cmd-organization-policy-security.mts')

describe('cmd-organization-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganizationPolicy.description).toBe(
        'Organization policy details',
      )
    })

    it('should not be hidden', () => {
      expect(cmdOrganizationPolicy.hidden).toBe(false)
    })

    it('should have a run method', () => {
      expect(typeof cmdOrganizationPolicy.run).toBe('function')
    })
  })

  describe('subcommand routing', () => {
    const importMeta = { url: 'file:///test/cmd-organization-policy.mts' }
    const context = { parentName: 'socket organization' }

    it('should call meowWithSubcommands with correct configuration', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run(['security'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)
      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        {
          argv: ['security'],
          importMeta,
          name: 'socket organization policy',
          subcommands: {
            license: cmdOrganizationPolicyLicense,
            security: cmdOrganizationPolicySecurity,
          },
        },
        {
          defaultSub: 'list',
          description: 'Organization policy details',
        },
      )
    })

    it('should construct correct command name from parent', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run(['license'], importMeta, {
        parentName: 'custom-parent',
      })

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-parent policy',
        }),
        expect.anything(),
      )
    })

    it('should include all subcommands', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run([], importMeta, context)

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(Object.keys(subcommands)).toEqual(['security', 'license'])
    })

    it('should pass through argv unchanged', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = ['security', '--json']

      await cmdOrganizationPolicy.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })

    it('should handle readonly argv', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = Object.freeze(['license']) as readonly string[]

      await cmdOrganizationPolicy.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })
  })

  describe('subcommand validation', () => {
    it('should reference correct subcommand objects', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket organization' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(subcommands.security).toBe(cmdOrganizationPolicySecurity)
      expect(subcommands.license).toBe(cmdOrganizationPolicyLicense)
    })
  })

  describe('backwards compatibility', () => {
    it('should set defaultSub to list for backwards compatibility', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket organization' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.defaultSub).toBe('list')
    })
  })

  describe('error handling', () => {
    it('should propagate errors from meowWithSubcommands', async () => {
      const testError = new Error('Subcommand error')
      mockMeowWithSubcommands.mockRejectedValue(testError)

      await expect(
        cmdOrganizationPolicy.run(
          [],
          { url: 'file:///test' },
          { parentName: 'socket organization' },
        ),
      ).rejects.toThrow('Subcommand error')
    })
  })

  describe('options configuration', () => {
    it('should pass description in options', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket organization' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.description).toBe('Organization policy details')
    })

    it('should include both description and defaultSub', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganizationPolicy.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket organization' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options).toEqual({
        defaultSub: 'list',
        description: 'Organization policy details',
      })
    })
  })
})
