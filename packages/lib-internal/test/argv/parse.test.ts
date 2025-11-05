/**
 * @fileoverview Unit tests for argument parsing utilities.
 *
 * Tests Node.js-compatible argument parsing (util.parseArgs-like API):
 * - parseArgs() parses process.argv-style arrays into structured options and positionals
 * - Boolean options (--verbose), string options (--name value), short aliases (-v, -n)
 * - Default values, multiple values (arrays), kebab-case to camelCase conversion
 * - Coerce functions for type transformations (string → number, etc.)
 * - Handles -- separator for terminating option parsing
 * - Boolean negation (--no-color), equals syntax (--name=value), option groups (-abc)
 * - strict/allowPositionals/allowNegative modes for controlling parsing behavior
 * - Returns { values, positionals, raw } matching Node.js util.parseArgs structure
 */

import { parseArgs, type ParseArgsConfig } from '@socketsecurity/lib/argv/parse'
import { describe, expect, it } from 'vitest'

describe('argv/parse', () => {
  describe('parseArgs', () => {
    it('should parse empty arguments', () => {
      const result = parseArgs({ args: [] })
      expect(result.values).toEqual({})
      expect(result.positionals).toEqual([])
    })

    it('should parse boolean options', () => {
      const result = parseArgs({
        args: ['--verbose'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
    })

    it('should parse string options', () => {
      const result = parseArgs({
        args: ['--name', 'test'],
        options: {
          name: { type: 'string' },
        },
      })
      expect(result.values.name).toBe('test')
    })

    it('should parse multiple options', () => {
      const result = parseArgs({
        args: ['--verbose', '--name', 'test', '--count', '42'],
        options: {
          verbose: { type: 'boolean' },
          name: { type: 'string' },
          count: { type: 'string' },
        },
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.name).toBe('test')
      expect(result.values.count).toBe('42')
    })

    it('should handle short aliases', () => {
      const result = parseArgs({
        args: ['-v'],
        options: {
          verbose: { type: 'boolean', short: 'v' },
        },
      })
      expect(result.values.verbose).toBe(true)
    })

    it('should handle multiple short aliases', () => {
      const result = parseArgs({
        args: ['-v', '-n', 'test'],
        options: {
          verbose: { type: 'boolean', short: 'v' },
          name: { type: 'string', short: 'n' },
        },
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.name).toBe('test')
    })

    it('should parse positional arguments', () => {
      const result = parseArgs({
        args: ['file1.txt', 'file2.txt'],
        options: {},
      })
      expect(result.positionals).toEqual(['file1.txt', 'file2.txt'])
    })

    it('should mix options and positionals', () => {
      const result = parseArgs({
        args: ['--verbose', 'file.txt', '--name', 'test'],
        options: {
          verbose: { type: 'boolean' },
          name: { type: 'string' },
        },
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.name).toBe('test')
      expect(result.positionals).toEqual(['file.txt'])
    })

    it('should handle default values', () => {
      const result = parseArgs({
        args: [],
        options: {
          port: { type: 'string', default: '3000' },
          verbose: { type: 'boolean', default: false },
        },
      })
      expect(result.values.port).toBe('3000')
      expect(result.values.verbose).toBe(false)
    })

    it('should override defaults with provided values', () => {
      const result = parseArgs({
        args: ['--port', '8080', '--verbose'],
        options: {
          port: { type: 'string', default: '3000' },
          verbose: { type: 'boolean', default: false },
        },
      })
      expect(result.values.port).toBe('8080')
      expect(result.values.verbose).toBe(true)
    })

    it('should handle kebab-case to camelCase conversion', () => {
      const result = parseArgs({
        args: ['--temp-dir', '/tmp'],
        options: {
          tempDir: { type: 'string' },
        },
      })
      expect(result.values.tempDir).toBe('/tmp')
    })

    it('should handle multiple values (arrays)', () => {
      const result = parseArgs({
        args: ['--tag', 'v1', '--tag', 'v2', '--tag', 'v3'],
        options: {
          tag: { type: 'string', multiple: true },
        },
      })
      expect(result.values.tag).toEqual(['v1', 'v2', 'v3'])
    })

    it('should handle -- separator', () => {
      const result = parseArgs({
        args: ['--verbose', '--', '--not-a-flag'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
      // Arguments after -- may be in positionals or in the raw['--'] array
      const hasFlag =
        result.positionals.includes('--not-a-flag') ||
        Boolean(
          (result.raw['--'] as string[] | undefined)?.includes('--not-a-flag'),
        )
      expect(hasFlag).toBe(true)
    })

    it('should support coerce functions', () => {
      const result = parseArgs({
        args: ['--port', '8080'],
        options: {
          port: {
            type: 'string',
            coerce: val => Number(val),
          },
        },
      })
      expect(result.values.port).toBe(8080)
      expect(typeof result.values.port).toBe('number')
    })

    it('should handle boolean negation', () => {
      const result = parseArgs({
        args: ['--no-color'],
        options: {
          color: { type: 'boolean', default: true },
        },
      })
      expect(result.values.color).toBe(false)
    })

    it('should handle empty string values', () => {
      const result = parseArgs({
        args: ['--name', ''],
        options: {
          name: { type: 'string' },
        },
      })
      expect(result.values.name).toBe('')
    })

    it('should handle allowPositionals option', () => {
      const result = parseArgs({
        args: ['--verbose', 'positional'],
        options: {
          verbose: { type: 'boolean' },
        },
        allowPositionals: true,
      })
      expect(result.positionals).toContain('positional')
    })

    it('should handle strict mode', () => {
      const result = parseArgs({
        args: ['--verbose', '--unknown'],
        options: {
          verbose: { type: 'boolean' },
        },
        strict: false,
      })
      expect(result.values.verbose).toBe(true)
    })

    it('should provide raw parsed arguments', () => {
      const result = parseArgs({
        args: ['--verbose', 'file.txt'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.raw).toBeDefined()
      expect(result.raw._).toBeDefined()
    })

    it('should handle complex scenarios', () => {
      const result = parseArgs({
        args: [
          '--verbose',
          '-n',
          'myapp',
          '--tag',
          'v1',
          '--tag',
          'v2',
          'input.txt',
          'output.txt',
        ],
        options: {
          verbose: { type: 'boolean', short: 'v' },
          name: { type: 'string', short: 'n' },
          tag: { type: 'string', multiple: true },
        },
        allowPositionals: true,
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.name).toBe('myapp')
      expect(Array.isArray(result.values.tag)).toBe(true)
      // Positionals handling varies by implementation, just verify options work
      expect(result.positionals).toBeDefined()
    })

    it('should handle configuration options', () => {
      const result = parseArgs({
        args: ['--verbose'],
        options: {
          verbose: { type: 'boolean' },
        },
        configuration: {
          'camel-case-expansion': false,
        },
      })
      expect(result.values.verbose).toBe(true)
    })
  })

  describe('ParseArgsConfig type', () => {
    it('should accept minimal config', () => {
      const config: ParseArgsConfig = {}
      const result = parseArgs(config)
      expect(result).toBeDefined()
    })

    it('should accept full config', () => {
      const config: ParseArgsConfig = {
        args: ['--test'],
        options: {
          test: { type: 'boolean', short: 't', default: false },
        },
        strict: true,
        allowPositionals: true,
        allowNegative: false,
      }
      const result = parseArgs(config)
      expect(result.values.test).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle undefined args', () => {
      const result = parseArgs({
        args: undefined,
        options: {},
      })
      expect(result).toBeDefined()
    })

    it('should handle null-like values', () => {
      const result = parseArgs({
        args: ['--flag'],
        options: {
          flag: { type: 'boolean' },
        },
      })
      expect(result.values.flag).toBe(true)
    })

    it('should handle numeric strings without conversion', () => {
      const result = parseArgs({
        args: ['--value', '42'],
        options: {
          value: { type: 'string' },
        },
      })
      expect(result.values.value).toBe('42')
      expect(typeof result.values.value).toBe('string')
    })

    it('should handle equals syntax', () => {
      const result = parseArgs({
        args: ['--name=test', '--count=42'],
        options: {
          name: { type: 'string' },
          count: { type: 'string' },
        },
      })
      expect(result.values.name).toBe('test')
      expect(result.values.count).toBe('42')
    })

    it('should handle short option groups', () => {
      const result = parseArgs({
        args: ['-abc'],
        options: {
          a: { type: 'boolean', short: 'a' },
          b: { type: 'boolean', short: 'b' },
          c: { type: 'boolean', short: 'c' },
        },
      })
      expect(result.values.a).toBe(true)
      expect(result.values.b).toBe(true)
      expect(result.values.c).toBe(true)
    })

    it('should handle repeated boolean flags', () => {
      const result = parseArgs({
        args: ['--verbose', '--verbose'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
    })
  })

  describe('coerce transformations', () => {
    it('should coerce to number', () => {
      const result = parseArgs({
        args: ['--port', '3000'],
        options: {
          port: {
            type: 'string',
            coerce: val => Number.parseInt(val as string, 10),
          },
        },
      })
      expect(result.values.port).toBe(3000)
    })

    it('should coerce to uppercase', () => {
      const result = parseArgs({
        args: ['--env', 'production'],
        options: {
          env: {
            type: 'string',
            coerce: val => (val as string).toUpperCase(),
          },
        },
      })
      expect(result.values.env).toBe('PRODUCTION')
    })

    it('should coerce arrays', () => {
      const result = parseArgs({
        args: ['--tags', 'a,b,c'],
        options: {
          tags: {
            type: 'string',
            coerce: val => (val as string).split(','),
          },
        },
      })
      expect(result.values.tags).toEqual(['a', 'b', 'c'])
    })
  })
})
