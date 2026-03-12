/**
 * Unit tests for command registry help generation.
 *
 * Purpose:
 * Tests help text generation for CLI commands. Validates formatting and output.
 *
 * Test Coverage:
 * - generateCommandHelp formatting
 * - generateGlobalHelp formatting
 * - isHelpRequested detection
 * - Flag formatting
 *
 * Related Files:
 * - utils/command/registry-help.mts (implementation)
 */

import { describe, expect, it, vi } from 'vitest'

import {
  generateCommandHelp,
  generateGlobalHelp,
  isHelpRequested,
} from '../../../../src/utils/command/registry-help.mts'

import type { CommandDefinition } from '../../../../src/utils/command/registry-types.mjs'
import type { CommandRegistry } from '../../../../src/utils/command/registry.mts'

describe('registry-help', () => {
  describe('generateCommandHelp', () => {
    it('generates basic help text with name and description', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('test-cmd')
      expect(help).toContain('A test command')
      expect(help).toContain('Usage:')
      expect(help).toContain('socket test-cmd')
    })

    it('includes options text when flags are present', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          verbose: {
            type: 'boolean',
            description: 'Enable verbose output',
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('[options]')
      expect(help).toContain('Options:')
      expect(help).toContain('--verbose')
      expect(help).toContain('Enable verbose output')
    })

    it('includes aliases when present', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        aliases: ['tc', 'test'],
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('Aliases:')
      expect(help).toContain('tc, test')
    })

    it('includes examples when present', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        examples: ['socket test-cmd --flag', 'socket test-cmd file.txt'],
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('Examples:')
      expect(help).toContain('socket test-cmd --flag')
      expect(help).toContain('socket test-cmd file.txt')
    })

    it('formats flag with alias', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          verbose: {
            type: 'boolean',
            alias: 'v',
            description: 'Enable verbose output',
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('--verbose, -v')
    })

    it('formats string flag with type indicator', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          name: {
            type: 'string',
            description: 'The name',
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('<string>')
    })

    it('formats number flag with type indicator', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          count: {
            type: 'number',
            description: 'The count',
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('<number>')
    })

    it('formats array flag with type indicator', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          files: {
            type: 'array',
            description: 'The files',
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('<value...>')
    })

    it('shows default value for flag', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          count: {
            type: 'number',
            description: 'The count',
            default: 10,
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('(default: 10)')
    })

    it('shows required indicator for flag', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          name: {
            type: 'string',
            description: 'The name',
            isRequired: true,
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('[required]')
    })

    it('shows choices for flag', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          format: {
            type: 'string',
            description: 'Output format',
            choices: ['json', 'text', 'markdown'],
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      expect(help).toContain('[choices: json, text, markdown]')
    })

    it('does not include type indicator for boolean flags', () => {
      const command: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          verbose: {
            type: 'boolean',
            description: 'Enable verbose output',
          },
        },
        run: vi.fn(),
      }

      const help = generateCommandHelp(command)

      // Boolean flags don't have type indicators.
      expect(help).not.toContain('<boolean>')
    })
  })

  describe('generateGlobalHelp', () => {
    it('generates global help with header and usage', () => {
      const mockRegistry = {
        list: vi.fn().mockReturnValue([]),
      } as unknown as CommandRegistry

      const help = generateGlobalHelp(mockRegistry)

      expect(help).toContain('Socket CLI')
      expect(help).toContain('Usage:')
      expect(help).toContain('socket <command> [options]')
    })

    it('lists visible top-level commands', () => {
      const commands: CommandDefinition[] = [
        {
          name: 'scan',
          description: 'Scan for vulnerabilities',
          run: vi.fn(),
        },
        {
          name: 'optimize',
          description: 'Optimize dependencies',
          run: vi.fn(),
        },
      ]

      const mockRegistry = {
        list: vi.fn().mockImplementation((parent?: string) => {
          if (parent === undefined) {
            return commands
          }
          return []
        }),
      } as unknown as CommandRegistry

      const help = generateGlobalHelp(mockRegistry)

      expect(help).toContain('Commands:')
      expect(help).toContain('scan')
      expect(help).toContain('Scan for vulnerabilities')
      expect(help).toContain('optimize')
      expect(help).toContain('Optimize dependencies')
    })

    it('hides commands marked as hidden', () => {
      const commands: CommandDefinition[] = [
        {
          name: 'scan',
          description: 'Scan for vulnerabilities',
          run: vi.fn(),
        },
        {
          name: 'internal',
          description: 'Internal command',
          hidden: true,
          run: vi.fn(),
        },
      ]

      const mockRegistry = {
        list: vi.fn().mockImplementation((parent?: string) => {
          if (parent === undefined) {
            return commands
          }
          return []
        }),
      } as unknown as CommandRegistry

      const help = generateGlobalHelp(mockRegistry)

      expect(help).toContain('scan')
      expect(help).not.toContain('internal')
      expect(help).not.toContain('Internal command')
    })

    it('lists subcommands under their parent', () => {
      const topLevelCommands: CommandDefinition[] = [
        {
          name: 'organization',
          description: 'Manage organizations',
          run: vi.fn(),
        },
      ]

      const subcommands: CommandDefinition[] = [
        {
          name: 'list',
          description: 'List organizations',
          parent: 'organization',
          run: vi.fn(),
        },
        {
          name: 'create',
          description: 'Create organization',
          parent: 'organization',
          run: vi.fn(),
        },
      ]

      const mockRegistry = {
        list: vi.fn().mockImplementation((parent?: string) => {
          if (parent === undefined) {
            return topLevelCommands
          }
          if (parent === 'organization') {
            return subcommands
          }
          return []
        }),
      } as unknown as CommandRegistry

      const help = generateGlobalHelp(mockRegistry)

      expect(help).toContain('organization')
      expect(help).toContain('Manage organizations')
      expect(help).toContain('list')
      expect(help).toContain('List organizations')
      expect(help).toContain('create')
      expect(help).toContain('Create organization')
    })

    it('hides subcommands marked as hidden', () => {
      const topLevelCommands: CommandDefinition[] = [
        {
          name: 'organization',
          description: 'Manage organizations',
          run: vi.fn(),
        },
      ]

      const subcommands: CommandDefinition[] = [
        {
          name: 'list',
          description: 'List organizations',
          parent: 'organization',
          run: vi.fn(),
        },
        {
          name: 'internal',
          description: 'Internal subcommand',
          parent: 'organization',
          hidden: true,
          run: vi.fn(),
        },
      ]

      const mockRegistry = {
        list: vi.fn().mockImplementation((parent?: string) => {
          if (parent === undefined) {
            return topLevelCommands
          }
          if (parent === 'organization') {
            return subcommands
          }
          return []
        }),
      } as unknown as CommandRegistry

      const help = generateGlobalHelp(mockRegistry)

      expect(help).toContain('list')
      expect(help).not.toContain('Internal subcommand')
    })

    it('includes help footer', () => {
      const mockRegistry = {
        list: vi.fn().mockReturnValue([]),
      } as unknown as CommandRegistry

      const help = generateGlobalHelp(mockRegistry)

      expect(help).toContain('Run "socket <command> --help"')
    })
  })

  describe('isHelpRequested', () => {
    it('returns true for --help flag', () => {
      expect(isHelpRequested(['scan', '--help'])).toBe(true)
    })

    it('returns true for -h flag', () => {
      expect(isHelpRequested(['scan', '-h'])).toBe(true)
    })

    it('returns false when no help flag present', () => {
      expect(isHelpRequested(['scan', '--verbose'])).toBe(false)
    })

    it('returns false for empty args', () => {
      expect(isHelpRequested([])).toBe(false)
    })

    it('returns true when help flag is first', () => {
      expect(isHelpRequested(['--help', 'scan'])).toBe(true)
    })

    it('returns true when help flag is in middle', () => {
      expect(isHelpRequested(['scan', '--help', '--verbose'])).toBe(true)
    })
  })
})
