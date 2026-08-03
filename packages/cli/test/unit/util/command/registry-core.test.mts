/**
 * @file Tests for command registry system.
 *   Covers registration, unregistration, listing, and plugin install. See
 *   registry-core-execute.test.mts for execute()/middleware coverage.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { CommandRegistry } from '../../../../src/util/command/registry.mts'

import type { CommandDefinition } from '../../../../src/util/command/types.mts'

describe('CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  describe('register()', () => {
    it('should register a command', () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      expect(registry.has('test')).toBe(true)
      expect(registry.get('test')).toBe(command)
    })

    it('should register command aliases', () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'tst'],
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      expect(registry.has('test')).toBe(true)
      expect(registry.has('t')).toBe(true)
      expect(registry.has('tst')).toBe(true)
      expect(registry.get('t')).toBe(command)
      expect(registry.get('tst')).toBe(command)
    })

    it('should throw error when registering duplicate command', () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      expect(() => registry.register(command)).toThrow(
        /cannot register command "test": already registered/,
      )
    })

    it('should throw error when alias conflicts with existing command', () => {
      const cmd1: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      const cmd2: CommandDefinition = {
        name: 'other',
        description: 'Other command',
        aliases: ['test'],
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(cmd1)

      expect(() => registry.register(cmd2)).toThrow(
        /cannot register command "other" alias "test": conflicts with command "test"/,
      )
    })
  })

  describe('unregister()', () => {
    it('should unregister a command', () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)
      expect(registry.has('test')).toBe(true)

      const result = registry.unregister('test')

      expect(result).toBe(true)
      expect(registry.has('test')).toBe(false)
    })

    it('should unregister command aliases', () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        aliases: ['t', 'tst'],
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)
      expect(registry.has('t')).toBe(true)
      expect(registry.has('tst')).toBe(true)

      registry.unregister('test')

      expect(registry.has('test')).toBe(false)
      expect(registry.has('t')).toBe(false)
      expect(registry.has('tst')).toBe(false)
    })

    it('should return false when unregistering unknown command', () => {
      const result = registry.unregister('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('list()', () => {
    it('should list all commands', () => {
      const cmd1: CommandDefinition = {
        name: 'test1',
        description: 'Test 1',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      const cmd2: CommandDefinition = {
        name: 'test2',
        description: 'Test 2',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(cmd1)
      registry.register(cmd2)

      const commands = registry.list()
      expect(commands).toHaveLength(2)
      expect(commands).toContainEqual(cmd1)
      expect(commands).toContainEqual(cmd2)
    })

    it('should filter commands by parent', () => {
      const parent: CommandDefinition = {
        name: 'org',
        description: 'Organization commands',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      const child: CommandDefinition = {
        name: 'org:list',
        description: 'List organizations',
        parent: 'org',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      const other: CommandDefinition = {
        name: 'scan',
        description: 'Scan command',
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(parent)
      registry.register(child)
      registry.register(other)

      const orgCommands = registry.list('org')
      expect(orgCommands).toHaveLength(1)
      expect(orgCommands[0]).toBe(child)
    })

    it('should deduplicate aliases in list', () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        aliases: ['t'],
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const commands = registry.list()
      expect(commands).toHaveLength(1)
      expect(commands[0]).toBe(command)
    })
  })

  describe('plugins', () => {
    it('should install plugin and call its install method', () => {
      let installed = false
      const plugin = {
        name: 'test-plugin',
        install(reg: CommandRegistry) {
          installed = true
          // Plugin can register commands.
          reg.register({
            name: 'plugin-cmd',
            description: 'Plugin command',
            async handler() {
              return { ok: true, data: undefined }
            },
          })
        },
      }

      registry.use(plugin)

      expect(installed).toBe(true)
      expect(registry.has('plugin-cmd')).toBe(true)
    })
  })
})
