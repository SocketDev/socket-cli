/**
 * Unit tests for command definition utilities.
 *
 * Purpose:
 * Tests the defineCommand helper for registering CLI commands.
 *
 * Test Coverage:
 * - Command registration
 * - Definition passthrough
 *
 * Related Files:
 * - utils/command/registry-define.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockRegister = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/command/registry.mts', () => ({
  registry: {
    register: mockRegister,
  },
}))

import { defineCommand } from '../../../../src/utils/command/registry-define.mts'

import type { CommandDefinition } from '../../../../src/utils/command/registry-types.mjs'

describe('registry-define', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('defineCommand', () => {
    it('registers the command with the global registry', () => {
      const definition: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        run: vi.fn(),
      }

      defineCommand(definition)

      expect(mockRegister).toHaveBeenCalledTimes(1)
      expect(mockRegister).toHaveBeenCalledWith(definition)
    })

    it('returns the definition unchanged', () => {
      const definition: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        run: vi.fn(),
      }

      const result = defineCommand(definition)

      expect(result).toBe(definition)
    })

    it('handles command with flags', () => {
      const definition: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        flags: {
          verbose: {
            type: 'boolean',
            description: 'Verbose output',
          },
        },
        run: vi.fn(),
      }

      const result = defineCommand(definition)

      expect(mockRegister).toHaveBeenCalledWith(definition)
      expect(result.flags).toBeDefined()
      expect(result.flags!['verbose']).toBeDefined()
    })

    it('handles command with aliases', () => {
      const definition: CommandDefinition = {
        name: 'test-cmd',
        description: 'A test command',
        aliases: ['tc', 't'],
        run: vi.fn(),
      }

      const result = defineCommand(definition)

      expect(result.aliases).toEqual(['tc', 't'])
    })

    it('handles command with parent', () => {
      const definition: CommandDefinition = {
        name: 'create',
        description: 'Create something',
        parent: 'organization',
        run: vi.fn(),
      }

      const result = defineCommand(definition)

      expect(result.parent).toBe('organization')
    })
  })
})
