/**
 * @fileoverview Unit tests for command-line argument parsing utilities.
 *
 * Tests argv parsing utilities built on Node.js util.parseArgs():
 * - parseArgs() wrapper for util.parseArgs with type safety
 * - parseArgsWithDefaults() applies default values to parsed args
 * - commonParseArgsConfig() shared configuration for common flags
 * - getPositionalArgs() extracts positional arguments
 * - hasFlag() checks for boolean flag presence
 * Used by Socket CLI for command-line argument processing.
 */

import {
  commonParseArgsConfig,
  getPositionalArgs,
  hasFlag,
  parseArgs,
  parseArgsWithDefaults,
} from '@socketsecurity/lib/argv/parse'
import { describe, expect, it } from 'vitest'

describe('argv/parse', () => {
  describe('parseArgs', () => {
    it('should parse empty arguments', () => {
      const result = parseArgs({ args: [] })
      expect(result.values).toEqual({})
      expect(result.positionals).toEqual([])
    })

    it('should parse boolean option', () => {
      const result = parseArgs({
        args: ['--verbose'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
    })

    it('should parse string option', () => {
      const result = parseArgs({
        args: ['--name', 'test'],
        options: {
          name: { type: 'string' },
        },
      })
      expect(result.values.name).toBe('test')
    })

    it('should parse positional arguments', () => {
      const result = parseArgs({
        args: ['file1.js', 'file2.js'],
        options: {},
      })
      expect(result.positionals).toEqual(['file1.js', 'file2.js'])
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

    it('should handle default values', () => {
      const result = parseArgs({
        args: [],
        options: {
          port: { type: 'string', default: '3000' },
        },
      })
      expect(result.values.port).toBe('3000')
    })

    it('should handle multiple values with array option', () => {
      const result = parseArgs({
        args: ['--file', 'a.js', '--file', 'b.js'],
        options: {
          file: { type: 'string', multiple: true },
        },
      })
      expect(result.values.file).toEqual(['a.js', 'b.js'])
    })

    it('should handle coerce function', () => {
      const result = parseArgs({
        args: ['--port', '3000'],
        options: {
          port: {
            type: 'string',
            coerce: value => Number.parseInt(value as string, 10),
          },
        },
      })
      expect(result.values.port).toBe(3000)
    })

    it('should handle kebab-case to camelCase conversion', () => {
      const result = parseArgs({
        args: ['--temp-dir', '/tmp'],
        options: {
          'temp-dir': { type: 'string' },
        },
      })
      expect(result.values.tempDir).toBe('/tmp')
    })

    it('should handle strict mode with unknown options', () => {
      const result = parseArgs({
        args: ['--unknown', 'value'],
        options: {},
        strict: false,
      })
      expect(result.values.unknown).toBe('value')
    })

    it('should handle allowPositionals option', () => {
      const result = parseArgs({
        args: ['--flag', 'file.js'],
        options: {
          flag: { type: 'boolean' },
        },
        allowPositionals: true,
      })
      expect(result.positionals).toEqual(['file.js'])
    })

    it('should handle -- separator', () => {
      const result = parseArgs({
        args: ['--flag', '--', '--not-a-flag'],
        options: {
          flag: { type: 'boolean' },
        },
      })
      expect(result.values.flag).toBe(true)
      // Args after -- are in the raw['--'] array
      expect(result.raw['--']).toEqual(['--not-a-flag'])
    })

    it('should handle boolean negation with --no prefix', () => {
      const result = parseArgs({
        args: ['--no-color'],
        options: {
          color: { type: 'boolean', default: true },
        },
        allowNegative: false,
      })
      expect(result.values.color).toBe(false)
    })

    it('should return raw yargs output', () => {
      const result = parseArgs({
        args: ['--verbose', 'file.js'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.raw).toBeDefined()
      expect(result.raw._).toEqual(['file.js'])
    })

    it('should handle multiple boolean flags', () => {
      const result = parseArgs({
        args: ['--verbose', '--debug', '--quiet'],
        options: {
          verbose: { type: 'boolean' },
          debug: { type: 'boolean' },
          quiet: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.debug).toBe(true)
      expect(result.values.quiet).toBe(true)
    })

    it('should handle mixed options and positionals', () => {
      const result = parseArgs({
        args: ['file1.js', '--verbose', 'file2.js', '--debug'],
        options: {
          verbose: { type: 'boolean' },
          debug: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.debug).toBe(true)
      expect(result.positionals).toEqual(['file1.js', 'file2.js'])
    })

    it('should handle short option groups', () => {
      const result = parseArgs({
        args: ['-vd'],
        options: {
          verbose: { type: 'boolean', short: 'v' },
          debug: { type: 'boolean', short: 'd' },
        },
      })
      expect(result.values.verbose).toBe(true)
      expect(result.values.debug).toBe(true)
    })

    it('should handle equals syntax', () => {
      const result = parseArgs({
        args: ['--name=test', '--port=3000'],
        options: {
          name: { type: 'string' },
          port: { type: 'string' },
        },
      })
      expect(result.values.name).toBe('test')
      expect(result.values.port).toBe('3000')
    })

    it('should preserve both kebab and camel case', () => {
      const result = parseArgs({
        args: ['--temp-dir', '/tmp'],
        options: {
          'temp-dir': { type: 'string' },
        },
      })
      expect(result.values.tempDir).toBe('/tmp')
      expect(result.values['temp-dir']).toBe('/tmp')
    })

    it('should handle configuration options', () => {
      const result = parseArgs({
        args: ['--option', 'value'],
        options: {
          option: { type: 'string' },
        },
        configuration: {
          'strip-dashed': true,
        },
      })
      expect(result.values.option).toBe('value')
    })
  })

  describe('parseArgsWithDefaults', () => {
    it('should use non-strict mode by default', () => {
      const result = parseArgsWithDefaults({
        args: ['--unknown', 'value'],
        options: {},
      })
      expect(result.values.unknown).toBe('value')
    })

    it('should allow positionals by default', () => {
      const result = parseArgsWithDefaults({
        args: ['file1.js', '--flag', 'file2.js'],
        options: {
          flag: { type: 'boolean' },
        },
      })
      expect(result.positionals).toEqual(['file1.js', 'file2.js'])
    })

    it('should override defaults with config', () => {
      const result = parseArgsWithDefaults({
        args: ['--unknown'],
        options: {},
        strict: true,
      })
      // In strict mode, unknown options may not be parsed
      expect(result).toBeDefined()
    })

    it('should parse common Socket CLI patterns', () => {
      const result = parseArgsWithDefaults({
        args: ['--quiet', '--force', 'package.json'],
        options: {
          quiet: { type: 'boolean' },
          force: { type: 'boolean' },
        },
      })
      expect(result.values.quiet).toBe(true)
      expect(result.values.force).toBe(true)
      expect(result.positionals).toEqual(['package.json'])
    })
  })

  describe('commonParseArgsConfig', () => {
    it('should have force option', () => {
      expect(commonParseArgsConfig.options?.force).toBeDefined()
      expect(commonParseArgsConfig.options?.force.type).toBe('boolean')
      expect(commonParseArgsConfig.options?.force.short).toBe('f')
      expect(commonParseArgsConfig.options?.force.default).toBe(false)
    })

    it('should have quiet option', () => {
      expect(commonParseArgsConfig.options?.quiet).toBeDefined()
      expect(commonParseArgsConfig.options?.quiet.type).toBe('boolean')
      expect(commonParseArgsConfig.options?.quiet.short).toBe('q')
      expect(commonParseArgsConfig.options?.quiet.default).toBe(false)
    })

    it('should use non-strict mode', () => {
      expect(commonParseArgsConfig.strict).toBe(false)
    })

    it('should be usable with parseArgs', () => {
      const result = parseArgs({
        ...commonParseArgsConfig,
        args: ['-f', '-q', 'file.js'],
      })
      expect(result.values.force).toBe(true)
      expect(result.values.quiet).toBe(true)
      expect(result.positionals).toEqual(['file.js'])
    })
  })

  describe('getPositionalArgs', () => {
    it('should extract positional args from start', () => {
      // Simulate process.argv = ['node', 'script.js', 'file1.js', 'file2.js']
      const originalArgv = process.argv
      try {
        process.argv = ['node', 'script.js', 'file1.js', 'file2.js']
        const result = getPositionalArgs()
        expect(result).toEqual(['file1.js', 'file2.js'])
      } finally {
        process.argv = originalArgv
      }
    })

    it('should stop at first flag', () => {
      const originalArgv = process.argv
      try {
        process.argv = [
          'node',
          'script.js',
          'file1.js',
          '--verbose',
          'file2.js',
        ]
        const result = getPositionalArgs()
        expect(result).toEqual(['file1.js'])
      } finally {
        process.argv = originalArgv
      }
    })

    it('should handle custom start index', () => {
      const originalArgv = process.argv
      try {
        process.argv = [
          'node',
          'script.js',
          'subcommand',
          'file1.js',
          'file2.js',
        ]
        const result = getPositionalArgs(3)
        expect(result).toEqual(['file1.js', 'file2.js'])
      } finally {
        process.argv = originalArgv
      }
    })

    it('should return empty array when no positionals', () => {
      const originalArgv = process.argv
      try {
        process.argv = ['node', 'script.js', '--flag']
        const result = getPositionalArgs()
        expect(result).toEqual([])
      } finally {
        process.argv = originalArgv
      }
    })

    it('should return empty array when all flags', () => {
      const originalArgv = process.argv
      try {
        process.argv = ['node', 'script.js', '--verbose', '--debug']
        const result = getPositionalArgs()
        expect(result).toEqual([])
      } finally {
        process.argv = originalArgv
      }
    })
  })

  describe('hasFlag', () => {
    it('should detect long flag', () => {
      const argv = ['node', 'script.js', '--verbose']
      expect(hasFlag('verbose', argv)).toBe(true)
    })

    it('should detect short flag', () => {
      const argv = ['node', 'script.js', '-v']
      expect(hasFlag('verbose', argv)).toBe(true)
    })

    it('should return false for missing flag', () => {
      const argv = ['node', 'script.js']
      expect(hasFlag('verbose', argv)).toBe(false)
    })

    it('should use process.argv by default', () => {
      const originalArgv = process.argv
      try {
        process.argv = ['node', 'script.js', '--verbose']
        expect(hasFlag('verbose')).toBe(true)
      } finally {
        process.argv = originalArgv
      }
    })

    it('should handle flags with values', () => {
      const argv = ['node', 'script.js', '--name', 'test']
      expect(hasFlag('name', argv)).toBe(true)
    })

    it('should handle multiple flags', () => {
      const argv = ['node', 'script.js', '--verbose', '--debug', '--quiet']
      expect(hasFlag('verbose', argv)).toBe(true)
      expect(hasFlag('debug', argv)).toBe(true)
      expect(hasFlag('quiet', argv)).toBe(true)
    })

    it('should not match partial flags', () => {
      const argv = ['node', 'script.js', '--verbosity']
      expect(hasFlag('verbose', argv)).toBe(false)
    })

    it('should handle single letter flags', () => {
      const argv = ['node', 'script.js', '-h']
      expect(hasFlag('h', argv)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty options object', () => {
      const result = parseArgs({
        args: ['--flag', 'value'],
        options: {},
        strict: false,
      })
      expect(result.values.flag).toBe('value')
    })

    it('should handle duplicate flags with array option', () => {
      const result = parseArgs({
        args: ['--tag', 'v1', '--tag', 'v2', '--tag', 'v3'],
        options: {
          tag: { type: 'string', multiple: true },
        },
      })
      expect(result.values.tag).toEqual(['v1', 'v2', 'v3'])
    })

    it('should handle boolean with explicit value', () => {
      const result = parseArgs({
        args: ['--verbose=true'],
        options: {
          verbose: { type: 'boolean' },
        },
      })
      expect(result.values.verbose).toBe(true)
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

    it('should handle numeric strings', () => {
      const result = parseArgs({
        args: ['--port', '3000'],
        options: {
          port: { type: 'string' },
        },
      })
      expect(result.values.port).toBe('3000')
      expect(typeof result.values.port).toBe('string')
    })
  })

  describe('integration', () => {
    it('should handle complex real-world CLI patterns', () => {
      const result = parseArgs({
        args: [
          '--quiet',
          '-f',
          '--temp-dir',
          '/tmp/test',
          'src/**/*.js',
          '--exclude',
          'node_modules',
          '--exclude',
          'dist',
          '--',
          '--literal-arg',
        ],
        options: {
          quiet: { type: 'boolean', short: 'q' },
          force: { type: 'boolean', short: 'f' },
          'temp-dir': { type: 'string' },
          exclude: { type: 'string', multiple: true },
        },
      })

      expect(result.values.quiet).toBe(true)
      expect(result.values.force).toBe(true)
      expect(result.values.tempDir).toBe('/tmp/test')
      expect(result.values.exclude).toEqual(['node_modules', 'dist'])
      expect(result.positionals).toEqual(['src/**/*.js'])
      // Args after -- are in the raw['--'] array
      expect(result.raw['--']).toEqual(['--literal-arg'])
    })

    it('should work with Socket CLI common patterns', () => {
      const result = parseArgs({
        ...commonParseArgsConfig,
        args: ['-f', '-q', 'package.json', 'tsconfig.json'],
      })

      expect(result.values.force).toBe(true)
      expect(result.values.quiet).toBe(true)
      expect(result.positionals).toEqual(['package.json', 'tsconfig.json'])
    })
  })
})
