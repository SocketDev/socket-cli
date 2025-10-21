/** @fileoverview Tests for command registry system. */

import { beforeEach, describe, expect, it } from 'vitest'

import { CommandRegistry } from './registry.mts'

import type { CommandDefinition } from './types.mts'

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
        'Command "test" is already registered',
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
        'Alias "test" conflicts with existing command "test"',
      )
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

  describe('execute()', () => {
    it('should execute a command successfully', async () => {
      let executed = false
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          executed = true
          return { ok: true, data: 'success' }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', [])

      expect(result.ok).toBe(true)
      expect(executed).toBe(true)
    })

    it('should return error for unknown command', async () => {
      const result = await registry.execute('nonexistent', [])

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Unknown command: nonexistent')
    })

    it('should parse boolean flags', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          verbose: {
            type: 'boolean',
            description: 'Verbose output',
          },
        },
        async handler({ flags }) {
          expect(flags.verbose).toBe(true)
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      await registry.execute('test', ['--verbose'])
    })

    it('should parse string flags', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          name: {
            type: 'string',
            description: 'Name',
          },
        },
        async handler({ flags }) {
          expect(flags.name).toBe('foo')
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      await registry.execute('test', ['--name', 'foo'])
    })

    it('should parse flags with = syntax', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          name: {
            type: 'string',
            description: 'Name',
          },
        },
        async handler({ flags }) {
          expect(flags.name).toBe('foo')
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      await registry.execute('test', ['--name=foo'])
    })

    it('should use flag defaults', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          verbose: {
            type: 'boolean',
            description: 'Verbose',
            default: true,
          },
        },
        async handler({ flags }) {
          expect(flags.verbose).toBe(true)
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      await registry.execute('test', [])
    })

    it('should validate required flags', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          name: {
            type: 'string',
            description: 'Name',
            isRequired: true,
          },
        },
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', [])

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Required flag --name is missing')
    })

    it('should run validation function', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          count: {
            type: 'number',
            description: 'Count',
          },
        },
        validate(flags) {
          if (typeof flags.count === 'number' && flags.count < 0) {
            return {
              ok: false,
              errors: ['Count must be non-negative'],
            }
          }
          return { ok: true }
        },
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', ['--count', '-5'])

      expect(result.ok).toBe(false)
      expect(result.cause).toContain('Count must be non-negative')
    })
  })

  describe('middleware', () => {
    it('should execute middleware in order', async () => {
      const order: string[] = []

      registry.use(async (_ctx, next) => {
        order.push('middleware1-before')
        await next()
        order.push('middleware1-after')
      })

      registry.use(async (_ctx, next) => {
        order.push('middleware2-before')
        await next()
        order.push('middleware2-after')
      })

      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          order.push('handler')
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      await registry.execute('test', [])

      expect(order).toEqual([
        'middleware1-before',
        'middleware2-before',
        'handler',
        'middleware2-after',
        'middleware1-after',
      ])
    })

    it('should execute before and after hooks', async () => {
      const order: string[] = []

      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async before() {
          order.push('before')
        },
        async handler() {
          order.push('handler')
          return { ok: true, data: undefined }
        },
        async after() {
          order.push('after')
        },
      }

      registry.register(command)

      await registry.execute('test', [])

      expect(order).toEqual(['before', 'handler', 'after'])
    })
  })
})
