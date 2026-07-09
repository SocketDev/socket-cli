/**
 * @file Tests for command registry system.
 *   Covers execute() flag parsing/validation and middleware/hook dispatch. See
 *   registry-core.test.mts for registration, listing, and plugin coverage.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { CommandRegistry } from '../../../../src/util/command/registry.mts'

import type { CommandDefinition } from '../../../../src/util/command/types.mts'

describe('CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
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
      expect(result.message).toContain(
        'command "test" requires --name but it was not provided',
      )
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

    it('should error when string flag is missing value', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          name: {
            type: 'string',
            description: 'Name',
          },
        },
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', ['--name'])

      expect(result.ok).toBe(false)
      expect(result.message).toContain(
        'flag --name requires a string value but none was provided',
      )
    })

    it('should error when number flag has invalid value', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          count: {
            type: 'number',
            description: 'Count',
          },
        },
        async handler() {
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', ['--count', 'notanumber'])

      expect(result.ok).toBe(false)
      expect(result.message).toContain('flag --count requires a numeric value')
    })

    it('should parse array flags', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          tags: {
            type: 'array',
            description: 'Tags',
          },
        },
        async handler({ flags }) {
          expect(flags.tags).toEqual(['tag1', 'tag2', 'tag3'])
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', [
        '--tags',
        'tag1',
        '--tags',
        'tag2',
        '--tags',
        'tag3',
      ])

      expect(result.ok).toBe(true)
    })

    it('should parse array flags with = syntax', async () => {
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          tags: {
            type: 'array',
            description: 'Tags',
          },
        },
        async handler({ flags }) {
          expect(flags.tags).toEqual(['tag1', 'tag2'])
          return { ok: true, data: undefined }
        },
      }

      registry.register(command)

      const result = await registry.execute('test', [
        '--tags=tag1',
        '--tags=tag2',
      ])

      expect(result.ok).toBe(true)
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

    it('throws when middleware calls next() more than once', async () => {
      // Middleware function form: (ctx, next) => Promise<void>.
      registry.use(async (_ctx, next) => {
        await next()
        // Calling next() again — should trigger the dispatch detection.
        await next()
      })

      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        async handler() {
          return { ok: true, data: undefined }
        },
      }
      registry.register(command)

      // execute() doesn't reject — it catches and returns CResult.
      const result = await registry.execute('test', [])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toMatch(/next\(\) more than once/)
      }
    })

    it('skips non-flag arguments and unknown flags during parseFlags', async () => {
      let observedFlags: unknown
      const command: CommandDefinition = {
        name: 'test',
        description: 'Test command',
        flags: {
          known: { type: 'string', default: 'd' },
        },
        async handler(ctx) {
          observedFlags = ctx.flags
          return { ok: true, data: undefined }
        },
      }
      registry.register(command)

      // Mix of: positional, known flag, unknown flag.
      await registry.execute('test', [
        'positional-arg',
        '--known=v',
        '--unknown=ignored',
      ])

      expect(observedFlags.known).toBe('v')
      expect(observedFlags.unknown).toBeUndefined()
    })
  })
})
