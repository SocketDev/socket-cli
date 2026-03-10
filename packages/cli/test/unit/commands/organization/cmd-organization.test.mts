/**
 * Unit tests for organization parent command.
 *
 * Tests the parent command that routes to organization management subcommands.
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
const { cmdOrganization } = await import(
  '../../../../src/commands/organization/cmd-organization.mts'
)
const { cmdOrganizationDependencies } = await import(
  '../../../../src/commands/organization/cmd-organization-dependencies.mts'
)
const { cmdOrganizationList } = await import(
  '../../../../src/commands/organization/cmd-organization-list.mts'
)
const { cmdOrganizationPolicy } = await import(
  '../../../../src/commands/organization/cmd-organization-policy.mts'
)
const { cmdOrganizationPolicyLicense } = await import(
  '../../../../src/commands/organization/cmd-organization-policy-license.mts'
)
const { cmdOrganizationPolicySecurity } = await import(
  '../../../../src/commands/organization/cmd-organization-policy-security.mts'
)
const { cmdOrganizationQuota } = await import(
  '../../../../src/commands/organization/cmd-organization-quota.mts'
)

describe('cmd-organization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdOrganization.description).toBe(
        'Manage Socket organization account details',
      )
    })

    it('should not be hidden', () => {
      expect(cmdOrganization.hidden).toBe(false)
    })

    it('should have a run method', () => {
      expect(typeof cmdOrganization.run).toBe('function')
    })
  })

  describe('subcommand routing', () => {
    const importMeta = { url: 'file:///test/cmd-organization.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct configuration', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(['list'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledTimes(1)
      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        {
          argv: ['list'],
          importMeta,
          name: 'socket organization',
          subcommands: {
            dependencies: cmdOrganizationDependencies,
            list: cmdOrganizationList,
            policy: cmdOrganizationPolicy,
            quota: cmdOrganizationQuota,
          },
        },
        {
          aliases: {
            deps: {
              argv: ['dependencies'],
              description: cmdOrganizationDependencies.description,
              hidden: true,
            },
            license: {
              argv: ['policy', 'license'],
              description: cmdOrganizationPolicyLicense.description,
              hidden: true,
            },
            security: {
              argv: ['policy', 'security'],
              description: cmdOrganizationPolicySecurity.description,
              hidden: true,
            },
          },
          description: 'Manage Socket organization account details',
        },
      )
    })

    it('should construct correct command name from parent', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(['quota'], importMeta, {
        parentName: 'custom-parent',
      })

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom-parent organization',
        }),
        expect.anything(),
      )
    })

    it('should include all subcommands', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run([], importMeta, context)

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(Object.keys(subcommands)).toEqual([
        'dependencies',
        'list',
        'quota',
        'policy',
      ])
    })

    it('should pass through argv unchanged', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = ['dependencies', '--json']

      await cmdOrganization.run(argv, importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv,
        }),
        expect.anything(),
      )
    })

    it('should handle readonly argv', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)
      const argv = Object.freeze(['list']) as readonly string[]

      await cmdOrganization.run(argv, importMeta, context)

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

      await cmdOrganization.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = call[0].subcommands

      expect(subcommands.dependencies).toBe(cmdOrganizationDependencies)
      expect(subcommands.list).toBe(cmdOrganizationList)
      expect(subcommands.policy).toBe(cmdOrganizationPolicy)
      expect(subcommands.quota).toBe(cmdOrganizationQuota)
    })
  })

  describe('aliases configuration', () => {
    it('should configure deps alias for dependencies', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.deps).toEqual({
        argv: ['dependencies'],
        description: cmdOrganizationDependencies.description,
        hidden: true,
      })
    })

    it('should configure license alias for policy license', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.license).toEqual({
        argv: ['policy', 'license'],
        description: cmdOrganizationPolicyLicense.description,
        hidden: true,
      })
    })

    it('should configure security alias for policy security', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.security).toEqual({
        argv: ['policy', 'security'],
        description: cmdOrganizationPolicySecurity.description,
        hidden: true,
      })
    })

    it('should mark all aliases as hidden', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const aliases = call[1].aliases

      expect(aliases.deps.hidden).toBe(true)
      expect(aliases.license.hidden).toBe(true)
      expect(aliases.security.hidden).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should propagate errors from meowWithSubcommands', async () => {
      const testError = new Error('Subcommand error')
      mockMeowWithSubcommands.mockRejectedValue(testError)

      await expect(
        cmdOrganization.run(
          [],
          { url: 'file:///test' },
          { parentName: 'socket' },
        ),
      ).rejects.toThrow('Subcommand error')
    })
  })

  describe('options configuration', () => {
    it('should pass description in options', async () => {
      mockMeowWithSubcommands.mockResolvedValue(undefined)

      await cmdOrganization.run(
        [],
        { url: 'file:///test' },
        { parentName: 'socket' },
      )

      const call = mockMeowWithSubcommands.mock.calls[0]
      const options = call[1]

      expect(options.description).toBe(
        'Manage Socket organization account details',
      )
    })
  })
})
