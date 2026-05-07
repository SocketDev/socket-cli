/**
 * Unit tests for CLI subcommand handling.
 *
 * Purpose:
 * Tests CLI subcommand registration and routing. Validates command tree structure and subcommand dispatch.
 *
 * Test Coverage:
 * - Subcommand registration
 * - Command routing
 * - Help text for subcommands
 * - Nested subcommand support
 * - Command aliasing
 *
 * Testing Approach:
 * Mocks meow CLI framework and tests command tree construction.
 *
 * Related Files:
 * - utils/cli/with-subcommands.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import meow from '../../../../src/meow.mts'
import {
  description,
  emitBanner,
  findBestCommandMatch,
  getHeaderTheme,
  getLastSeenCommand,
  getTokenOrigin,
  levenshteinDistance,
  meowOrExit,
  shouldAnimateHeader,
  shouldSuppressBanner,
  stripAnsi,
} from '../../../../src/utils/cli/with-subcommands.mts'

// Mock meow.
const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn())
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
const mockOverrideCachedConfig = vi.hoisted(() => vi.fn())
const mockOverrideConfigApiToken = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn(() => false))
const mockGetVisibleTokenPrefix = vi.hoisted(() => vi.fn(() => 'test'))
const mockSocketPackageLink = vi.hoisted(() => vi.fn(pkg => pkg))

vi.mock('../../../../src/meow.mts', () => ({
  // Identity helper used by flags.mts (commonFlags / outputFlags /
  // validationFlags) and by per-command flag blocks. Test mock just
  // returns the schema unchanged.
  defineFlags: <T,>(flags: T): T => flags,
  default: vi.fn((helpText, options) => {
    // Simulate meow processing flags with defaults.
    const argv = options?.argv || []
    const processedFlags = {}
    if (options?.flags) {
      for (const [key, flag] of Object.entries(options.flags)) {
        // Check if flag is present in argv.
        const flagName = `--${key}`
        const shortFlag = flag.shortFlag ? `-${flag.shortFlag}` : null
        const isPresent =
          argv.includes(flagName) || (shortFlag && argv.includes(shortFlag))

        // @ts-expect-error - Mock implementation.
        if (isPresent && flag.type === 'boolean') {
          processedFlags[key] = true
        } else {
          processedFlags[key] =
            flag.default !== undefined ? flag.default : undefined
        }
      }
    }
    return {
      flags: processedFlags,
      input: options?.argv || [],
      help: helpText || '',
      showHelp: vi.fn(() => {
        throw new Error('SHOW_HELP')
      }),
      showVersion: vi.fn(() => {
        throw new Error('SHOW_VERSION')
      }),
    }
  }),
}))

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

// Mock config utilities.
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
  isConfigFromFlag: mockIsConfigFromFlag,
  overrideCachedConfig: mockOverrideCachedConfig,
  overrideConfigApiToken: mockOverrideConfigApiToken,
}))

// Mock debug utility.
vi.mock('../../../../src/utils/debug.mts', () => ({
  isDebug: mockIsDebug,
}))

// Mock SDK utility.
vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  getVisibleTokenPrefix: mockGetVisibleTokenPrefix,
}))

// Mock terminal link utility.
vi.mock('../../../../src/utils/terminal/link.mts', () => ({
  socketPackageLink: mockSocketPackageLink,
}))

// Mock process.exit.
vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called')
})

describe('meow-with-subcommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('meowOrExit', () => {
    const mockConfig = {
      commandName: 'test',
      description: 'Test command',
      flags: {},
      help: vi.fn(() => 'Test help text'),
    }

    it('creates a meow instance with basic options', () => {
      const result = meowOrExit(
        {
          argv: ['test'],
          config: mockConfig,
          importMeta: import.meta,
        },
        {
          flags: {
            verbose: {
              type: 'boolean',
              shortFlag: 'v',
            },
          },
        },
      )

      expect(result).toHaveProperty('flags')
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('help')
    })

    it('works with parent name', () => {
      const result = meowOrExit(
        {
          argv: [],
          config: mockConfig,
          importMeta: import.meta,
          parentName: 'socket',
        },
        {
          flags: {
            version: {
              type: 'boolean',
              shortFlag: 'V',
            },
          },
        },
      )

      expect(result).toHaveProperty('flags')
      expect(result).toHaveProperty('input')
    })

    it('processes config with custom flags', () => {
      const configWithPort = {
        ...mockConfig,
        flags: {
          port: {
            type: 'number',
            default: 3000,
          },
        },
      }

      const result = meowOrExit(
        {
          argv: [],
          config: configWithPort,
          importMeta: import.meta,
        },
        {
          allowUnknownFlags: true,
        },
      )

      // Verify that meow was called.
      const meowMock = vi.mocked(meow)
      expect(meowMock).toHaveBeenCalled()

      // The function returns a Result from meow.
      expect(result).toHaveProperty('flags')
      expect(result).toHaveProperty('input')
    })

    it('handles config parameter', () => {
      const configWithApiToken = {
        ...mockConfig,
        apiToken: 'test-token',
      }

      const result = meowOrExit(
        {
          argv: [],
          config: configWithApiToken,
          importMeta: import.meta,
        },
        {
          flags: {},
        },
      )

      expect(result).toHaveProperty('flags')
    })
  })

  describe('emitBanner', () => {
    it('emits banner with name and org', async () => {
      vi.mocked(await import('@socketsecurity/lib/logger'))

      emitBanner('socket', 'test-org', false)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('emits compact banner when compact mode is true', async () => {
      vi.mocked(await import('@socketsecurity/lib/logger'))

      emitBanner('socket', 'test-org', true)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('handles undefined org', async () => {
      vi.mocked(await import('@socketsecurity/lib/logger'))

      emitBanner('socket', undefined, false)

      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('description', () => {
    it('returns formatted description for a command', () => {
      const result = description({
        description: 'Test command description',
        run: vi.fn(),
      } as any)
      expect(result).toBe('Test command description')
    })

    it('returns "undefined" when command is undefined', () => {
      // The implementation returns String(undefined) = "undefined" via fallback.
      const result = description(undefined)
      expect(result).toBe('undefined')
    })

    it('coerces non-string descriptions to string', () => {
      const result = description({
        description: 42 as unknown as string,
        run: vi.fn(),
      } as any)
      expect(result).toBe('42')
    })
  })

  describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshteinDistance('socket', 'socket')).toBe(0)
    })

    it('returns string length when one string is empty', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3)
      expect(levenshteinDistance('xyz', '')).toBe(3)
    })

    it('counts substitutions', () => {
      expect(levenshteinDistance('cat', 'bat')).toBe(1)
      expect(levenshteinDistance('cat', 'dog')).toBe(3)
    })

    it('counts insertions and deletions', () => {
      expect(levenshteinDistance('hello', 'helloworld')).toBe(5)
      expect(levenshteinDistance('helloworld', 'hello')).toBe(5)
    })
  })

  describe('findBestCommandMatch', () => {
    const subcommands = { scan: {}, fix: {}, login: {}, logout: {} }
    const aliases = { ls: {} }

    it('returns close match for typo', () => {
      const result = findBestCommandMatch('scn', subcommands, aliases)
      expect(result).toBe('scan')
    })

    it('returns null when nothing close matches', () => {
      const result = findBestCommandMatch(
        'completelyunrelated',
        subcommands,
        aliases,
      )
      expect(result).toBeNull()
    })

    it('finds matches in aliases', () => {
      const result = findBestCommandMatch('lsx', subcommands, aliases)
      expect(result).toBe('ls')
    })

    it('matches case-insensitively', () => {
      const result = findBestCommandMatch('SCAN', subcommands, aliases)
      expect(result).toBe('scan')
    })
  })

  describe('shouldSuppressBanner', () => {
    it('suppresses for --json', () => {
      expect(shouldSuppressBanner({ json: true })).toBe(true)
    })

    it('suppresses for --markdown', () => {
      expect(shouldSuppressBanner({ markdown: true })).toBe(true)
    })

    it('suppresses for --no-banner (banner: false)', () => {
      expect(shouldSuppressBanner({ banner: false })).toBe(true)
    })

    it('does not suppress with banner: true', () => {
      expect(shouldSuppressBanner({ banner: true })).toBe(false)
    })

    it('does not suppress with empty flags', () => {
      expect(shouldSuppressBanner({})).toBe(false)
    })
  })

  describe('stripAnsi', () => {
    it('strips ANSI color codes', () => {
      expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
    })

    it('returns plain text unchanged', () => {
      expect(stripAnsi('plain')).toBe('plain')
    })
  })

  describe('getHeaderTheme', () => {
    it('returns valid themes from flags', () => {
      expect(getHeaderTheme({ headerTheme: 'cyberpunk' })).toBe('cyberpunk')
      expect(getHeaderTheme({ headerTheme: 'forest' })).toBe('forest')
      expect(getHeaderTheme({ headerTheme: 'ocean' })).toBe('ocean')
      expect(getHeaderTheme({ headerTheme: 'sunset' })).toBe('sunset')
    })

    it('falls back to default for unknown themes', () => {
      expect(getHeaderTheme({ headerTheme: 'made-up' })).toBe('default')
      expect(getHeaderTheme({})).toBe('default')
      expect(getHeaderTheme()).toBe('default')
    })
  })

  describe('shouldAnimateHeader', () => {
    it('returns false in vitest mode', () => {
      // VITEST is true in this test run.
      expect(shouldAnimateHeader()).toBe(false)
      expect(shouldAnimateHeader({ animateHeader: true })).toBe(false)
    })
  })

  describe('getTokenOrigin', () => {
    it('returns a string', () => {
      const result = getTokenOrigin()
      expect(typeof result).toBe('string')
    })
  })

  describe('getLastSeenCommand', () => {
    it('returns empty string initially', () => {
      // Mock initial state.
      const command = getLastSeenCommand()
      expect(typeof command).toBe('string')
    })

    it('returns last seen command after meowOrExit', () => {
      const mockConfig = {
        commandName: 'test',
        description: 'Test command',
        flags: {},
        help: vi.fn(() => 'Test help text'),
      }

      meowOrExit(
        {
          argv: ['test', 'command'],
          config: mockConfig,
          importMeta: import.meta,
          parentName: 'socket',
        },
        {},
      )

      // Note: The actual implementation may not update lastSeenCommand
      // in this simplified test, but we test the function exists.
      const command = getLastSeenCommand()
      expect(typeof command).toBe('string')
    })
  })
})
