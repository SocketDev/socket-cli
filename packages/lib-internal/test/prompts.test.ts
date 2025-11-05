/**
 * @fileoverview Unit tests for interactive prompt exports.
 *
 * Tests prompt function exports and types:
 * - confirm() boolean yes/no prompts
 * - input() text input prompts
 * - password() masked password input
 * - select() single-choice selection
 * - search() searchable list selection
 * - Separator and createSeparator() for visual grouping
 * Used by Socket CLI for interactive user input and configuration.
 */

import {
  Separator,
  confirm,
  createSeparator,
  input,
  password,
  search,
  select,
} from '@socketsecurity/lib/stdio/prompts'
import type { Choice } from '@socketsecurity/lib/stdio/prompts'
import { describe, expect, it } from 'vitest'

describe('prompts', () => {
  describe('exports', () => {
    it('should export all prompt functions', () => {
      expect(typeof confirm).toBe('function')
      expect(typeof input).toBe('function')
      expect(typeof password).toBe('function')
      expect(typeof search).toBe('function')
      expect(typeof select).toBe('function')
    })

    it('should export Separator', () => {
      expect(Separator).toBeDefined()
      expect(typeof Separator).toBe('function')
    })

    it('should export createSeparator helper', () => {
      expect(typeof createSeparator).toBe('function')
    })
  })

  describe('createSeparator', () => {
    it('should create a separator instance', () => {
      const separator = createSeparator()
      expect(separator).toBeInstanceOf(Separator)
      expect(separator.type).toBe('separator')
    })

    it('should create a separator with custom text', () => {
      const separator = createSeparator('---')
      expect(separator).toBeInstanceOf(Separator)
      expect(separator.separator).toBe('---')
    })
  })

  describe('Choice type', () => {
    it('should accept Choice with name property', () => {
      // Type check: This should compile without errors
      const choices: Array<Choice<string>> = [
        { name: 'Option 1', value: '1' },
        { name: 'Option 2', value: '2' },
      ]
      expect(choices).toHaveLength(2)
      expect(choices[0].name).toBe('Option 1')
    })

    it('should accept Choice with description and disabled', () => {
      // Type check: This should compile without errors
      const choices: Array<Choice<string>> = [
        {
          description: 'First option',
          disabled: false,
          name: 'Option 1',
          value: '1',
        },
        {
          description: 'Second option',
          disabled: 'Not available',
          name: 'Option 2',
          value: '2',
        },
      ]
      expect(choices).toHaveLength(2)
      expect(choices[0].description).toBe('First option')
      expect(choices[1].disabled).toBe('Not available')
    })

    it('should accept Choice with all optional properties', () => {
      // Type check: This should compile without errors
      const choices: Array<Choice<string>> = [
        {
          description: 'Detailed option',
          disabled: false,
          name: 'Full Option',
          short: 'Full',
          value: 'full',
        },
      ]
      expect(choices[0].name).toBe('Full Option')
      expect(choices[0].short).toBe('Full')
      expect(choices[0].description).toBe('Detailed option')
    })
  })
})
