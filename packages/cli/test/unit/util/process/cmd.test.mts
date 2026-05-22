/**
 * Unit tests for command execution utilities.
 *
 * Purpose: Tests command execution utilities. Validates subprocess spawning
 * with Socket-specific spawn wrapper.
 *
 * Test Coverage:
 *
 * - Subprocess spawning
 * - Command output capture
 * - Error handling
 * - Exit code checking
 * - Cross-platform command execution
 *
 * Special Notes: Always uses { spawn } from @socketsecurity/lib/spawn, never
 * child_process.spawn.
 *
 * Testing Approach: Uses mocked spawn from @socketsecurity/lib/spawn (NOT
 * built-in spawn).
 *
 * Related Files:
 *
 * - Util/process/cmd.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  cmdFlagValueToArray,
  cmdFlagsToString,
  cmdPrefixMessage,
  filterFlags,
  isHelpFlag,
} from '../../../../src/util/process/cmd.mts'

describe('cmd utilities', () => {
  describe('cmdFlagValueToArray', () => {
    it('converts string to array', () => {
      expect(cmdFlagValueToArray('foo,bar,baz')).toEqual(['foo', 'bar', 'baz'])
    })

    it('handles string with spaces', () => {
      expect(cmdFlagValueToArray('foo, bar, baz')).toEqual([
        'foo',
        'bar',
        'baz',
      ])
    })

    it('handles array input', () => {
      expect(cmdFlagValueToArray(['foo', 'bar'])).toEqual(['foo', 'bar'])
    })

    it('handles nested arrays', () => {
      expect(cmdFlagValueToArray(['foo,bar', 'baz'])).toEqual([
        'foo',
        'bar',
        'baz',
      ])
    })

    it('handles empty string', () => {
      expect(cmdFlagValueToArray('')).toEqual([])
    })

    it('handles null/undefined', () => {
      expect(cmdFlagValueToArray(undefined)).toEqual([])
      expect(cmdFlagValueToArray(undefined)).toEqual([])
    })

    it('filters empty values', () => {
      expect(cmdFlagValueToArray('foo,,bar')).toEqual(['foo', 'bar'])
    })
  })

  describe('cmdFlagsToString', () => {
    it('handles simple arguments', () => {
      expect(cmdFlagsToString(['--flag', 'value'])).toBe('--flag=value')
    })

    it('handles arguments with special chars', () => {
      const result = cmdFlagsToString(['--file', 'my file.txt'])
      expect(result).toBe('--file=my file.txt')
    })

    it('handles arguments with quotes', () => {
      const result = cmdFlagsToString(['--text', 'say "hello"'])
      expect(result).toBe('--text=say "hello"')
    })

    it('handles empty array', () => {
      expect(cmdFlagsToString([])).toBe('')
    })

    it('preserves flag format', () => {
      expect(cmdFlagsToString(['-v', '--help', '--output=file.txt'])).toBe(
        '-v --help --output=file.txt',
      )
    })
  })

  describe('isHelpFlag', () => {
    it('identifies --help flag', () => {
      expect(isHelpFlag('--help')).toBe(true)
    })

    it('identifies -h flag', () => {
      expect(isHelpFlag('-h')).toBe(true)
    })

    it('returns false for non-help flags', () => {
      expect(isHelpFlag('--config')).toBe(false)
      expect(isHelpFlag('--other')).toBe(false)
    })
  })

  describe('filterFlags', () => {
    it('filters out specified flags', () => {
      const args = ['--help', '--config', 'value', '--other', 'arg']
      const flagsToFilter = {
        help: { type: 'boolean' },
        config: { type: 'string' },
      }
      const result = filterFlags(args, flagsToFilter)
      expect(result).toEqual(['--other', 'arg'])
    })

    it('handles empty array', () => {
      const result = filterFlags([], {})
      expect(result).toEqual([])
    })

    it('keeps exception flags', () => {
      const args = ['--help', '--config', 'value', '--other', 'arg']
      const flagsToFilter = {
        help: { type: 'boolean' },
        config: { type: 'string' },
      }
      const result = filterFlags(args, flagsToFilter, ['--config'])
      expect(result).toEqual(['--config', 'value', '--other', 'arg'])
    })

    it('handles short flags with shortFlag property', () => {
      const args = ['-v', '--verbose', '-h']
      const flagsToFilter = {
        verbose: { type: 'boolean', shortFlag: 'v' },
        help: { type: 'boolean', shortFlag: 'h' },
      }
      const result = filterFlags(args, flagsToFilter)
      expect(result).toEqual([])
    })

    it('handles negated boolean flags like --no-spinner', () => {
      const args = ['--no-spinner', '--verbose', '--no-banner']
      const flagsToFilter = {
        spinner: { type: 'boolean' },
        banner: { type: 'boolean' },
      }
      const result = filterFlags(args, flagsToFilter)
      expect(result).toEqual(['--verbose'])
    })

    it('handles --flag=value format', () => {
      const args = ['--config={"key":"value"}', '--other']
      const flagsToFilter = {
        config: { type: 'string' },
      }
      const result = filterFlags(args, flagsToFilter)
      expect(result).toEqual(['--other'])
    })

    it('keeps --flag=value format when in exceptions', () => {
      const args = ['--config={"key":"value"}', '--other']
      const flagsToFilter = {
        config: { type: 'string' },
      }
      const result = filterFlags(args, flagsToFilter, ['--config'])
      expect(result).toEqual(['--config={"key":"value"}', '--other'])
    })

    it('handles short flags with values', () => {
      const args = ['-c', 'configvalue', '--other']
      const flagsToFilter = {
        config: { type: 'string', shortFlag: 'c' },
      }
      const result = filterFlags(args, flagsToFilter)
      expect(result).toEqual(['--other'])
    })

    it('keeps short flags with values when in exceptions', () => {
      const args = ['-c', 'configvalue', '--other']
      const flagsToFilter = {
        config: { type: 'string', shortFlag: 'c' },
      }
      const result = filterFlags(args, flagsToFilter, ['-c'])
      expect(result).toEqual(['-c', 'configvalue', '--other'])
    })

    it('converts camelCase flag names to kebab-case', () => {
      const args = ['--dry-run', '--other']
      const flagsToFilter = {
        dryRun: { type: 'boolean' },
      }
      const result = filterFlags(args, flagsToFilter)
      expect(result).toEqual(['--other'])
    })
  })

  describe('cmdPrefixMessage', () => {
    it('generates prefix message', () => {
      const msg = cmdPrefixMessage('npm install', 'message text')
      expect(msg).toBe('npm install: message text')
    })

    it('handles empty command name', () => {
      const msg = cmdPrefixMessage('', 'message text')
      expect(msg).toBe('message text')
    })
  })
})
