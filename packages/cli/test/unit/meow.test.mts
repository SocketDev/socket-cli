/**
 * Unit tests for meow CLI helper.
 *
 * Purpose:
 * Tests the simplified meow-like CLI argument parsing helper.
 *
 * Test Coverage:
 * - Basic argument parsing
 * - Flag parsing (boolean, string, number types)
 * - Short flags and aliases
 * - Default values
 * - Boolean defaults
 * - Unknown flag collection
 * - Help text generation
 * - Package.json reading from importMeta
 *
 * Related Files:
 * - src/meow.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock readPackageJsonSync.
const mockReadPackageJsonSync = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/packages', () => ({
  readPackageJsonSync: mockReadPackageJsonSync,
}))

import meow from '../../src/meow.mts'

describe('meow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadPackageJsonSync.mockReturnValue({
      name: 'test-cli',
      version: '1.0.0',
    })
  })

  describe('basic parsing', () => {
    it('parses positional arguments', () => {
      const result = meow({
        argv: ['arg1', 'arg2'],
      })

      expect(result.input).toEqual(['arg1', 'arg2'])
    })

    it('returns empty input for no arguments', () => {
      const result = meow({
        argv: [],
      })

      expect(result.input).toEqual([])
    })

    it('uses process.argv.slice(2) by default', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'script.js', 'test-arg']

      const result = meow({})

      process.argv = originalArgv
      expect(result.input).toContain('test-arg')
    })
  })

  describe('flag parsing', () => {
    it('parses boolean flags', () => {
      const result = meow({
        argv: ['--verbose'],
        flags: {
          verbose: {
            type: 'boolean',
          },
        },
      })

      expect(result.flags['verbose']).toBe(true)
    })

    it('parses string flags', () => {
      const result = meow({
        argv: ['--name', 'test'],
        flags: {
          name: {
            type: 'string',
          },
        },
      })

      expect(result.flags['name']).toBe('test')
    })

    it('parses number flags', () => {
      const result = meow({
        argv: ['--count', '42'],
        flags: {
          count: {
            type: 'number',
          },
        },
      })

      expect(result.flags['count']).toBe(42)
    })

    it('handles short flags', () => {
      const result = meow({
        argv: ['-v'],
        flags: {
          verbose: {
            type: 'boolean',
            shortFlag: 'v',
          },
        },
      })

      expect(result.flags['verbose']).toBe(true)
    })

    it('handles flag aliases as string', () => {
      const result = meow({
        argv: ['--quiet'],
        flags: {
          verbose: {
            type: 'boolean',
            alias: 'quiet',
          },
        },
      })

      expect(result.flags['quiet']).toBe(true)
    })

    it('handles flag aliases as array', () => {
      const result = meow({
        argv: ['--q'],
        flags: {
          verbose: {
            type: 'boolean',
            aliases: ['q', 'quiet'],
          },
        },
      })

      expect(result.flags['q']).toBe(true)
    })

    it('uses default values when flag not provided', () => {
      const result = meow({
        argv: [],
        flags: {
          port: {
            type: 'number',
            default: 3000,
          },
        },
      })

      expect(result.flags['port']).toBe(3000)
    })
  })

  describe('boolean defaults', () => {
    it('applies booleanDefault to undefined boolean flags', () => {
      const result = meow({
        argv: [],
        flags: {
          verbose: {
            type: 'boolean',
          },
        },
        booleanDefault: false,
      })

      expect(result.flags['verbose']).toBe(false)
    })

    it('does not override explicit boolean flags with booleanDefault', () => {
      const result = meow({
        argv: ['--verbose'],
        flags: {
          verbose: {
            type: 'boolean',
          },
        },
        booleanDefault: false,
      })

      expect(result.flags['verbose']).toBe(true)
    })
  })

  describe('unknown flags', () => {
    it('collects unknown flags when enabled', () => {
      const result = meow({
        argv: ['--unknown', '--another-flag'],
        flags: {},
        collectUnknownFlags: true,
      })

      expect(result.unknownFlags).toContain('--unknown')
      expect(result.unknownFlags).toContain('--another-flag')
    })

    it('returns empty unknownFlags when not collecting', () => {
      const result = meow({
        argv: [],
        flags: {},
        collectUnknownFlags: false,
      })

      expect(result.unknownFlags).toEqual([])
    })
  })

  describe('help text', () => {
    it('includes description in help text', () => {
      const result = meow({
        argv: [],
        description: 'A test CLI tool',
      })

      expect(result.help).toContain('A test CLI tool')
    })

    it('includes custom help text', () => {
      const result = meow({
        argv: [],
        help: 'Usage: test [options]',
      })

      expect(result.help).toContain('Usage: test [options]')
    })

    it('applies help indent to multiline help text', () => {
      const result = meow({
        argv: [],
        help: 'Line 1\nLine 2',
        helpIndent: 4,
      })

      expect(result.help).toContain('    Line 1')
      expect(result.help).toContain('    Line 2')
    })

    it('omits description when set to false', () => {
      const result = meow({
        argv: [],
        description: false,
        help: 'Usage: test',
      })

      expect(result.help).not.toContain('undefined')
    })
  })

  describe('package.json reading', () => {
    it('reads package.json from importMeta url', () => {
      const result = meow({
        argv: [],
        importMeta: { url: 'file:///path/to/script.js' } as ImportMeta,
      })

      expect(result.pkg).toEqual({ name: 'test-cli', version: '1.0.0' })
    })

    it('returns empty object when importMeta is not provided', () => {
      const result = meow({
        argv: [],
      })

      expect(result.pkg).toEqual({})
    })

    it('handles package.json read failure gracefully', () => {
      mockReadPackageJsonSync.mockImplementation(() => {
        throw new Error('File not found')
      })

      const result = meow({
        argv: [],
        importMeta: { url: 'file:///path/to/script.js' } as ImportMeta,
      })

      expect(result.pkg).toEqual({})
    })
  })

  describe('showHelp and showVersion', () => {
    it('showHelp logs help text', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      const result = meow({
        argv: [],
        help: 'Test help',
      })

      expect(() => result.showHelp()).toThrow('exit')
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Test help'))
      expect(mockExit).toHaveBeenCalledWith(2)

      mockExit.mockRestore()
    })

    it('showVersion logs version from package.json', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      const result = meow({
        argv: [],
        importMeta: { url: 'file:///path/to/script.js' } as ImportMeta,
      })

      expect(() => result.showVersion()).toThrow('exit')
      expect(mockLogger.log).toHaveBeenCalledWith('1.0.0')
      expect(mockExit).toHaveBeenCalledWith(0)

      mockExit.mockRestore()
    })

    it('showVersion logs 0.0.0 when no version in package.json', () => {
      mockReadPackageJsonSync.mockReturnValue({})
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      const result = meow({
        argv: [],
        importMeta: { url: 'file:///path/to/script.js' } as ImportMeta,
      })

      expect(() => result.showVersion()).toThrow('exit')
      expect(mockLogger.log).toHaveBeenCalledWith('0.0.0')

      mockExit.mockRestore()
    })
  })

  describe('multiple flags', () => {
    it('handles isMultiple flag option', () => {
      const result = meow({
        argv: ['--include', 'a', '--include', 'b'],
        flags: {
          include: {
            type: 'string',
            isMultiple: true,
          },
        },
      })

      expect(result.flags['include']).toEqual(['a', 'b'])
    })
  })

  describe('number conversion', () => {
    it('handles invalid number values gracefully', () => {
      const result = meow({
        argv: ['--count', 'not-a-number'],
        flags: {
          count: {
            type: 'number',
          },
        },
      })

      // Value stays as string when NaN.
      expect(result.flags['count']).toBe('not-a-number')
    })
  })
})
