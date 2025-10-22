import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
  getFlagsHelpOutput,
  getHelpListOutput,
} from './output-formatting.mts'

// Mock requirements module.
vi.mock('./requirements.mts', () => ({
  getRequirements: vi.fn(),
  getRequirementsKey: vi.fn(),
}))

describe('output-formatting utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getFlagApiRequirementsOutput', () => {
    it('formats API requirements with quota and permissions', async () => {
      const { getRequirements, getRequirementsKey } = vi.mocked(
        await import('./requirements.mts'),
      )

      getRequirementsKey.mockReturnValue('scan:create')
      getRequirements.mockReturnValue({
        api: {
          'scan:create': {
            quota: 10,
            permissions: ['read', 'write', 'admin'],
          },
        },
      } as any)

      const result = getFlagApiRequirementsOutput('socket scan create')
      expect(result).toContain('- Quota: 10 units')
      expect(result).toContain('- Permissions: admin, read, and write')
    })

    it('formats quota only when present', async () => {
      const { getRequirements, getRequirementsKey } = vi.mocked(
        await import('./requirements.mts'),
      )

      getRequirementsKey.mockReturnValue('test')
      getRequirements.mockReturnValue({
        api: {
          test: {
            quota: 1,
          },
        },
      } as any)

      const result = getFlagApiRequirementsOutput('test')
      expect(result).toBe('- Quota: 1 unit')
    })

    it('formats permissions only when present', async () => {
      const { getRequirements, getRequirementsKey } = vi.mocked(
        await import('./requirements.mts'),
      )

      getRequirementsKey.mockReturnValue('test')
      getRequirements.mockReturnValue({
        api: {
          test: {
            permissions: ['execute'],
          },
        },
      } as any)

      const result = getFlagApiRequirementsOutput('test')
      expect(result).toBe('- Permissions: execute')
    })

    it('returns (none) when no requirements found', async () => {
      const { getRequirements, getRequirementsKey } = vi.mocked(
        await import('./requirements.mts'),
      )

      getRequirementsKey.mockReturnValue('missing')
      getRequirements.mockReturnValue({
        api: {},
      } as any)

      const result = getFlagApiRequirementsOutput('missing')
      expect(result).toBe('(none)')
    })

    it('respects custom indent option', async () => {
      const { getRequirements, getRequirementsKey } = vi.mocked(
        await import('./requirements.mts'),
      )

      getRequirementsKey.mockReturnValue('test')
      getRequirements.mockReturnValue({
        api: {
          test: {
            quota: 5,
          },
        },
      } as any)

      const result = getFlagApiRequirementsOutput('test', { indent: 2 })
      expect(result).toBe('- Quota: 5 units')
    })
  })

  describe('getFlagListOutput', () => {
    it('formats flag list with descriptions', () => {
      const flags = {
        help: { description: 'Show help information' },
        verbose: { description: 'Enable verbose output' },
        quiet: { description: 'Suppress output' },
      }

      const result = getFlagListOutput(flags)
      expect(result).toContain('--help')
      expect(result).toContain('Show help information')
      expect(result).toContain('--verbose')
      expect(result).toContain('Enable verbose output')
      expect(result).toContain('--quiet')
      expect(result).toContain('Suppress output')
    })

    it('converts camelCase flag names to kebab-case', () => {
      const flags = {
        dryRun: { description: 'Perform a dry run' },
        noInteractive: { description: 'Disable interactive mode' },
      }

      const result = getFlagListOutput(flags)
      expect(result).toContain('--dry-run')
      expect(result).toContain('--no-interactive')
    })

    it('hides flags marked as hidden', () => {
      const flags = {
        visible: { description: 'Visible flag' },
        hidden: { description: 'Hidden flag', hidden: true },
        alsoVisible: { description: 'Another visible flag', hidden: false },
      }

      const result = getFlagListOutput(flags)
      expect(result).toContain('--visible')
      expect(result).toContain('--also-visible')
      expect(result).not.toContain('--hidden')
    })

    it('respects custom options', () => {
      const flags = {
        test: { description: 'Test flag' },
      }

      const result = getFlagListOutput(flags, {
        indent: 2,
        keyPrefix: '-',
        padName: 10,
      })

      expect(result).toMatch(/-test\s+Test flag/)
    })

    it('returns (none) for empty flag list', () => {
      const result = getFlagListOutput({})
      expect(result).toBe('(none)')
    })
  })

  describe('getFlagsHelpOutput', () => {
    it('is an alias for getFlagListOutput', () => {
      expect(getFlagsHelpOutput).toBe(getFlagListOutput)
    })
  })

  describe('getHelpListOutput', () => {
    it('formats help list with descriptions', () => {
      const list = {
        init: { description: 'Initialize a new project' },
        build: { description: 'Build the project' },
        test: { description: 'Run tests' },
      }

      const result = getHelpListOutput(list)
      expect(result).toContain('init')
      expect(result).toContain('Initialize a new project')
      expect(result).toContain('build')
      expect(result).toContain('Build the project')
      expect(result).toContain('test')
      expect(result).toContain('Run tests')
    })

    it('sorts items in natural order', () => {
      const list = {
        item10: { description: 'Item 10' },
        item2: { description: 'Item 2' },
        item1: { description: 'Item 1' },
      }

      const result = getHelpListOutput(list)
      const lines = result.split('\n')
      expect(lines[0]).toContain('item1')
      expect(lines[1]).toContain('item2')
      expect(lines[2]).toContain('item10')
    })

    it('handles string descriptions', () => {
      const list = {
        simple: 'Simple description' as any,
        object: { description: 'Object description' },
      }

      const result = getHelpListOutput(list)
      expect(result).toContain('Simple description')
      expect(result).toContain('Object description')
    })

    it('pads names to align descriptions', () => {
      const list = {
        short: { description: 'Short name' },
        verylongname: { description: 'Long name' },
      }

      const result = getHelpListOutput(list, { padName: 15 })
      const lines = result.split('\n')

      // Both descriptions should start at similar positions.
      const shortLine = lines.find(l => l.includes('short'))!
      const longLine = lines.find(l => l.includes('verylongname'))!

      expect(shortLine).toMatch(/short\s+Short name/)
      expect(longLine).toMatch(/verylongname\s+Long name/)
    })

    it('handles empty descriptions', () => {
      const list = {
        empty: { description: '' },
        noDesc: {} as any,
      }

      const result = getHelpListOutput(list)
      expect(result).toContain('empty')
      expect(result).toContain('no-desc')
    })

    it('applies key prefix when specified', () => {
      const list = {
        command: { description: 'A command' },
      }

      const result = getHelpListOutput(list, { keyPrefix: 'prefix-' })
      expect(result).toContain('prefix-command')
    })

    it('returns (none) for empty list', () => {
      const result = getHelpListOutput({})
      expect(result).toBe('(none)')
    })

    it('filters out hidden items', () => {
      const list = {
        visible1: { description: 'Visible 1' },
        hidden1: { description: 'Hidden 1', hidden: true },
        visible2: { description: 'Visible 2', hidden: false },
      }

      const result = getHelpListOutput(list)
      expect(result).toContain('visible1')
      expect(result).toContain('visible2')
      expect(result).not.toContain('hidden1')
    })
  })
})
