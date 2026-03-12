/**
 * Unit tests for command registry barrel file.
 *
 * Purpose:
 * Tests the command registry barrel exports.
 *
 * Test Coverage:
 * - Named exports
 * - Type exports (runtime verification)
 *
 * Related Files:
 * - src/utils/command/registry.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  CommandRegistry,
  defineCommand,
  generateCommandHelp,
  generateGlobalHelp,
  isHelpRequested,
  registry,
} from '../../../../src/utils/command/registry.mts'

describe('command/registry barrel exports', () => {
  describe('class exports', () => {
    it('exports CommandRegistry class', () => {
      expect(CommandRegistry).toBeDefined()
      expect(typeof CommandRegistry).toBe('function')
    })

    it('CommandRegistry can be instantiated', () => {
      const instance = new CommandRegistry()
      expect(instance).toBeInstanceOf(CommandRegistry)
    })
  })

  describe('singleton exports', () => {
    it('exports registry singleton', () => {
      expect(registry).toBeDefined()
      expect(registry).toBeInstanceOf(CommandRegistry)
    })
  })

  describe('function exports', () => {
    it('exports defineCommand function', () => {
      expect(typeof defineCommand).toBe('function')
    })

    it('exports generateCommandHelp function', () => {
      expect(typeof generateCommandHelp).toBe('function')
    })

    it('exports generateGlobalHelp function', () => {
      expect(typeof generateGlobalHelp).toBe('function')
    })

    it('exports isHelpRequested function', () => {
      expect(typeof isHelpRequested).toBe('function')
    })
  })

  describe('isHelpRequested behavior', () => {
    it('returns true for --help flag', () => {
      expect(isHelpRequested(['--help'])).toBe(true)
    })

    it('returns true for -h flag', () => {
      expect(isHelpRequested(['-h'])).toBe(true)
    })

    it('returns false for help subcommand (only flags recognized)', () => {
      // isHelpRequested only checks for --help and -h flags, not 'help' subcommand.
      expect(isHelpRequested(['help'])).toBe(false)
    })

    it('returns false for empty args', () => {
      expect(isHelpRequested([])).toBe(false)
    })

    it('returns false for regular args', () => {
      expect(isHelpRequested(['scan', 'create'])).toBe(false)
    })
  })

  describe('defineCommand behavior', () => {
    it('creates a valid command definition', () => {
      const cmd = defineCommand({
        name: 'test',
        description: 'Test command',
        handler: async () => {},
      })

      expect(cmd.name).toBe('test')
      expect(cmd.description).toBe('Test command')
      expect(typeof cmd.handler).toBe('function')
    })

    it('supports hidden flag', () => {
      const cmd = defineCommand({
        name: 'hidden-test',
        description: 'Hidden test command',
        hidden: true,
        handler: async () => {},
      })

      expect(cmd.hidden).toBe(true)
    })

    it('supports flags definition', () => {
      const cmd = defineCommand({
        name: 'flag-test',
        description: 'Command with flags',
        flags: {
          verbose: {
            type: 'boolean',
            short: 'v',
            description: 'Enable verbose output',
          },
        },
        handler: async () => {},
      })

      expect(cmd.flags).toBeDefined()
      expect(cmd.flags!['verbose']).toBeDefined()
    })
  })
})
