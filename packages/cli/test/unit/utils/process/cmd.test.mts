import { describe, expect, it } from 'vitest'

import {
  cmdFlagsToString,
  cmdFlagValueToArray,
  cmdPrefixMessage,
  filterFlags,
  getConfigFlag,
  isAddCommand,
  isConfigFlag,
  isHelpFlag,
  isNpmLockfileScanCommand,
  isPnpmLockfileScanCommand,
  isYarnLockfileScanCommand,
} from '../../../../../src/utils/process/cmd.mts'

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
      expect(cmdFlagValueToArray(null)).toEqual([])
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

  describe('isConfigFlag', () => {
    it('identifies --config flag', () => {
      expect(isConfigFlag('--config')).toBe(true)
    })

    it('does not identify -c as config flag', () => {
      expect(isConfigFlag('-c')).toBe(false)
    })

    it('identifies --config=value format', () => {
      expect(isConfigFlag('--config=value')).toBe(true)
    })

    it('returns false for non-config flags', () => {
      expect(isConfigFlag('--help')).toBe(false)
      expect(isConfigFlag('--other')).toBe(false)
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

  describe('isAddCommand', () => {
    it('identifies add command', () => {
      expect(isAddCommand('add')).toBe(true)
    })

    it('does not identify install as add command', () => {
      expect(isAddCommand('install')).toBe(false)
      expect(isAddCommand('i')).toBe(false)
    })

    it('returns false for non-add commands', () => {
      expect(isAddCommand('remove')).toBe(false)
      expect(isAddCommand('update')).toBe(false)
    })
  })

  describe('isNpmLockfileScanCommand', () => {
    it('identifies npm lockfile scan commands', () => {
      expect(isNpmLockfileScanCommand('install')).toBe(true)
      expect(isNpmLockfileScanCommand('i')).toBe(true)
      expect(isNpmLockfileScanCommand('update')).toBe(true)
    })

    it('returns false for non-npm scan commands', () => {
      expect(isNpmLockfileScanCommand('test')).toBe(false)
      expect(isNpmLockfileScanCommand('run')).toBe(false)
    })
  })

  describe('isPnpmLockfileScanCommand', () => {
    it('identifies pnpm lockfile scan commands', () => {
      expect(isPnpmLockfileScanCommand('install')).toBe(true)
      expect(isPnpmLockfileScanCommand('i')).toBe(true)
      expect(isPnpmLockfileScanCommand('update')).toBe(true)
      expect(isPnpmLockfileScanCommand('up')).toBe(true)
    })

    it('returns false for non-pnpm scan commands', () => {
      expect(isPnpmLockfileScanCommand('test')).toBe(false)
      expect(isPnpmLockfileScanCommand('run')).toBe(false)
      expect(isPnpmLockfileScanCommand('add')).toBe(false)
    })
  })

  describe('isYarnLockfileScanCommand', () => {
    it('identifies yarn lockfile scan commands', () => {
      expect(isYarnLockfileScanCommand('install')).toBe(true)
      expect(isYarnLockfileScanCommand('up')).toBe(true)
      expect(isYarnLockfileScanCommand('upgrade')).toBe(true)
      expect(isYarnLockfileScanCommand('upgrade-interactive')).toBe(true)
    })

    it('returns false for non-yarn scan commands', () => {
      expect(isYarnLockfileScanCommand('test')).toBe(false)
      expect(isYarnLockfileScanCommand('run')).toBe(false)
      expect(isYarnLockfileScanCommand('add')).toBe(false)
    })
  })

  describe('getConfigFlag', () => {
    it('extracts config value from --config=value', () => {
      const result = getConfigFlag(['--config={"key":"value"}'])
      expect(result).toBe('{"key":"value"}')
    })

    it('extracts config value from separate arguments', () => {
      const result = getConfigFlag(['--config', '{"key":"value"}'])
      expect(result).toBe('{"key":"value"}')
    })

    it('returns undefined when no config flag', () => {
      const result = getConfigFlag(['--other', 'arg'])
      expect(result).toBeUndefined()
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
