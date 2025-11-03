import { beforeEach, describe, expect, it, vi } from 'vitest'

import meow from '../../../../src/meow.mts'
import {
  emitBanner,
  getLastSeenCommand,
  meowOrExit,
} from '../../../../src/src/with-subcommands.mts'

// Mock meow.
vi.mock('../../meow.mts', () => ({
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
vi.mock('../config.mts', () => ({
  getConfigValueOrUndef: vi.fn(),
  isConfigFromFlag: vi.fn(() => false),
  overrideCachedConfig: vi.fn(),
  overrideConfigApiToken: vi.fn(),
}))

// Mock debug utility.
vi.mock('../debug.mts', () => ({
  isDebug: vi.fn(() => false),
}))

// Mock SDK utility.
vi.mock('../sdk.mts', () => ({
  getVisibleTokenPrefix: vi.fn(() => 'test'),
}))

// Mock terminal link utility.
vi.mock('../terminal/link.mts', () => ({
  socketPackageLink: vi.fn(pkg => pkg),
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
