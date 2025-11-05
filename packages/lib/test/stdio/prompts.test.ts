/**
 * @fileoverview Unit tests for stdio user prompt utilities.
 *
 * Tests inquirer.js integration and prompt utilities for interactive CLI prompts:
 * - createInquirerTheme() converts Socket themes to inquirer-compatible theme objects
 * - Choice<T> type for prompt options with value, name, description, short text, and disabled states
 * - Context type for prompt configuration (signal, input/output streams, clearPromptOnDone)
 * - Validates theme passthrough for non-Socket themes
 * - Tests type definitions for building type-safe interactive CLI prompts
 * Used by Socket CLI tools for user interactions like selecting options, confirming actions.
 */

import {
  createInquirerTheme,
  type Choice,
  type Context,
} from '@socketsecurity/lib/stdio/prompts'
import { describe, expect, it } from 'vitest'

describe('stdio/prompts', () => {
  describe('createInquirerTheme', () => {
    it('should create theme from valid inputs', () => {
      // Test that the function exists and returns an object
      const result = createInquirerTheme({})
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })

    it('should pass through non-Socket themes', () => {
      const inquirerTheme = { style: {}, icon: {} }
      const result = createInquirerTheme(inquirerTheme)
      expect(result).toBe(inquirerTheme)
    })

    it('should handle Theme object', () => {
      const socketTheme = {
        name: 'custom',
        colors: {
          primary: 'blue',
          secondary: 'green',
          success: 'green',
          error: 'red',
          warning: 'yellow',
          info: 'cyan',
          step: 'cyan',
        },
      }
      const theme = createInquirerTheme(socketTheme)
      expect(theme).toBeDefined()
    })
  })

  describe('Choice type', () => {
    it('should accept minimal choice', () => {
      const choice: Choice<string> = {
        value: 'option1',
      }
      expect(choice.value).toBe('option1')
    })

    it('should accept choice with name', () => {
      const choice: Choice<number> = {
        value: 1,
        name: 'First Option',
      }
      expect(choice.name).toBe('First Option')
    })

    it('should accept choice with description', () => {
      const choice: Choice<string> = {
        value: 'opt1',
        name: 'Option 1',
        description: 'This is the first option',
      }
      expect(choice.description).toBe('This is the first option')
    })

    it('should accept choice with short text', () => {
      const choice: Choice<string> = {
        value: 'long-option-value',
        name: 'Long Option Name',
        short: 'Long',
      }
      expect(choice.short).toBe('Long')
    })

    it('should accept disabled boolean', () => {
      const choice: Choice<string> = {
        value: 'disabled-option',
        disabled: true,
      }
      expect(choice.disabled).toBe(true)
    })

    it('should accept disabled reason string', () => {
      const choice: Choice<string> = {
        value: 'option',
        disabled: 'Not available in current context',
      }
      expect(choice.disabled).toBe('Not available in current context')
    })

    it('should accept all properties', () => {
      const choice: Choice<string> = {
        value: 'complete',
        name: 'Complete Option',
        description: 'A fully specified choice',
        short: 'Complete',
        disabled: false,
      }
      expect(choice.value).toBe('complete')
      expect(choice.name).toBe('Complete Option')
      expect(choice.description).toBe('A fully specified choice')
      expect(choice.short).toBe('Complete')
      expect(choice.disabled).toBe(false)
    })
  })

  describe('Context type', () => {
    it('should accept minimal context', () => {
      const context: Context = {}
      expect(context).toBeDefined()
    })

    it('should accept context with signal', () => {
      const controller = new AbortController()
      const context: Context = {
        signal: controller.signal,
      }
      expect(context.signal).toBeDefined()
    })

    it('should accept context with streams', () => {
      const context: Context = {
        input: process.stdin,
        output: process.stdout,
      }
      expect(context.input).toBe(process.stdin)
      expect(context.output).toBe(process.stdout)
    })

    it('should accept context with clearPromptOnDone', () => {
      const context: Context = {
        clearPromptOnDone: true,
      }
      expect(context.clearPromptOnDone).toBe(true)
    })

    it('should accept all context properties', () => {
      const controller = new AbortController()
      const context: Context = {
        signal: controller.signal,
        input: process.stdin,
        output: process.stdout,
        clearPromptOnDone: false,
      }
      expect(context.signal).toBeDefined()
      expect(context.input).toBe(process.stdin)
      expect(context.output).toBe(process.stdout)
      expect(context.clearPromptOnDone).toBe(false)
    })
  })

  describe('theme handling', () => {
    it('should handle null theme', () => {
      const theme = createInquirerTheme(null)
      expect(theme).toBeDefined()
    })
  })

  describe('Choice arrays', () => {
    it('should accept array of choices', () => {
      const choices: Array<Choice<number>> = [
        { value: 1, name: 'One' },
        { value: 2, name: 'Two' },
        { value: 3, name: 'Three' },
      ]
      expect(choices).toHaveLength(3)
      expect(choices[0]?.value).toBe(1)
    })

    it('should accept mixed enabled/disabled choices', () => {
      const choices: Array<Choice<string>> = [
        { value: 'option1', name: 'Option 1' },
        { value: 'option2', name: 'Option 2', disabled: true },
        { value: 'option3', name: 'Option 3', disabled: 'Coming soon' },
      ]
      expect(choices[1]?.disabled).toBe(true)
      expect(choices[2]?.disabled).toBe('Coming soon')
    })
  })
})
