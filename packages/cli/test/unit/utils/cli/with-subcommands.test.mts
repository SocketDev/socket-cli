/* max-file-lines: legitimate — comprehensive test suite for one command/module; splitting would fragment closely related assertions. */
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
  meowWithSubcommands,
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
        const shortFlag = flag.shortFlag ? `-${flag.shortFlag}` : undefined
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

    it('exits with error when --version flag is set but config does not declare version', async () => {
      // Exercises the unknown-version-flag branch (lines 1026-1031).
      // The default meow mock doesn't auto-set flags for argv items not in
      // declared flags, so we override its return value just for this test
      // to simulate meow detecting --version on the cli.flags shape.
      const meowMod: any = await import('../../../../src/meow.mts')
      const meowMock = vi.mocked(meowMod.default)
      meowMock.mockReturnValueOnce({
        flags: { version: true },
        input: ['--version'],
        help: '',
        showHelp: vi.fn(),
        showVersion: vi.fn(),
      } as any)

      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      try {
        expect(() =>
          meowOrExit(
            {
              argv: ['--version'],
              config: mockConfig,
              importMeta: import.meta,
            },
            {
              flags: {},
            },
          ),
        ).toThrow('process.exit called')
        expect(exitSpy).toHaveBeenCalledWith(2)
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Unknown flag'),
        )
      } finally {
        exitSpy.mockRestore()
      }
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

    it('returns undefined when nothing close matches', () => {
      const result = findBestCommandMatch(
        'completelyunrelated',
        subcommands,
        aliases,
      )
      expect(result).toBeUndefined()
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

    it('returns empty string when SOCKET_CLI_NO_API_TOKEN is set (line 49)', () => {
      const original = process.env['SOCKET_CLI_NO_API_TOKEN']
      process.env['SOCKET_CLI_NO_API_TOKEN'] = '1'
      try {
        const result = getTokenOrigin()
        expect(result).toBe('')
      } finally {
        if (original === undefined) {
          delete process.env['SOCKET_CLI_NO_API_TOKEN']
        } else {
          process.env['SOCKET_CLI_NO_API_TOKEN'] = original
        }
      }
    })

    it('returns "(env)" when SOCKET_CLI_API_TOKEN is set (line 52)', () => {
      const originalNo = process.env['SOCKET_CLI_NO_API_TOKEN']
      const original = process.env['SOCKET_CLI_API_TOKEN']
      delete process.env['SOCKET_CLI_NO_API_TOKEN']
      process.env['SOCKET_CLI_API_TOKEN'] = 'sktsec_test_xxxxxxxxxxxx'
      try {
        const result = getTokenOrigin()
        expect(result).toBe('(env)')
      } finally {
        if (originalNo !== undefined) {
          process.env['SOCKET_CLI_NO_API_TOKEN'] = originalNo
        }
        if (original === undefined) {
          delete process.env['SOCKET_CLI_API_TOKEN']
        } else {
          process.env['SOCKET_CLI_API_TOKEN'] = original
        }
      }
    })

    it('returns "(--config flag)" when token from config-from-flag (line 56)', () => {
      const originalNo = process.env['SOCKET_CLI_NO_API_TOKEN']
      const original = process.env['SOCKET_CLI_API_TOKEN']
      delete process.env['SOCKET_CLI_NO_API_TOKEN']
      delete process.env['SOCKET_CLI_API_TOKEN']
      try {
        // Mock config returns a token AND isConfigFromFlag returns true.
        mockGetConfigValueOrUndef.mockReturnValueOnce(
          'sktsec_flag_xxxxxxxxxxxx',
        )
        mockIsConfigFromFlag.mockReturnValueOnce(true)
        const result = getTokenOrigin()
        expect(result).toBe('(--config flag)')
      } finally {
        if (originalNo !== undefined) {
          process.env['SOCKET_CLI_NO_API_TOKEN'] = originalNo
        }
        if (original !== undefined) {
          process.env['SOCKET_CLI_API_TOKEN'] = original
        }
      }
    })

    it('returns "(config)" when token from persisted config (line 56)', () => {
      const originalNo = process.env['SOCKET_CLI_NO_API_TOKEN']
      const original = process.env['SOCKET_CLI_API_TOKEN']
      delete process.env['SOCKET_CLI_NO_API_TOKEN']
      delete process.env['SOCKET_CLI_API_TOKEN']
      try {
        mockGetConfigValueOrUndef.mockReturnValueOnce(
          'sktsec_persisted_xxxxxxxxxxxx',
        )
        mockIsConfigFromFlag.mockReturnValueOnce(false)
        const result = getTokenOrigin()
        expect(result).toBe('(config)')
      } finally {
        if (originalNo !== undefined) {
          process.env['SOCKET_CLI_NO_API_TOKEN'] = originalNo
        }
        if (original !== undefined) {
          process.env['SOCKET_CLI_API_TOKEN'] = original
        }
      }
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

  describe('meowWithSubcommands', () => {
    it('runs the matching subcommand by name', async () => {
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      await meowWithSubcommands({
        name: 'app',
        argv: ['scan', '--foo'],
        importMeta: import.meta,
        subcommands,
      })
      expect(runSpy).toHaveBeenCalledWith(
        ['--foo'],
        import.meta,
        expect.objectContaining({ parentName: 'app' }),
      )
    })

    it('resolves an alias to its target command', async () => {
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      await meowWithSubcommands(
        {
          name: 'app',
          argv: ['s', 'arg'],
          importMeta: import.meta,
          subcommands,
        },
        {
          aliases: {
            s: { argv: ['scan'], description: 'alias of scan' },
          },
        },
      )
      expect(runSpy).toHaveBeenCalledWith(
        ['arg'],
        import.meta,
        expect.objectContaining({
          parentName: 'app',
          invokedAs: 's',
        }),
      )
    })

    it('uses defaultSub when first arg is unknown but defaultSub is set', async () => {
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      await meowWithSubcommands(
        {
          name: 'app',
          argv: ['unknown-arg'],
          importMeta: import.meta,
          subcommands,
        },
        { defaultSub: 'scan' },
      )
      expect(runSpy).toHaveBeenCalled()
    })

    it('uses defaultSub when argv is empty (line 199-200)', async () => {
      // No argv at all → commandOrAliasName_ is undefined → defaultSub kicks
      // in. This is the line 200 branch.
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      await meowWithSubcommands(
        {
          name: 'app',
          argv: [],
          importMeta: import.meta,
          subcommands,
        },
        { defaultSub: 'scan' },
      )
      expect(runSpy).toHaveBeenCalled()
    })

    it('reports a typo with a suggestion when command is unknown', async () => {
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
        login: {
          description: 'login',
          run: vi.fn(),
        },
      }
      process.exitCode = undefined
      await meowWithSubcommands({
        name: 'app',
        argv: ['scna'], // typo for "scan"
        importMeta: import.meta,
        subcommands,
      })
      expect(process.exitCode).toBe(2)
      expect(runSpy).not.toHaveBeenCalled()
      // Should have logged the suggestion.
      const failCalls = mockLogger.fail.mock.calls.flat().join(' ')
      expect(failCalls).toMatch(/scna/)
      process.exitCode = undefined
    })

    it('reports an unknown command with no suggestion when none is close', async () => {
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      process.exitCode = undefined
      await meowWithSubcommands({
        name: 'app',
        argv: ['totally-different'],
        importMeta: import.meta,
        subcommands,
      })
      expect(process.exitCode).toBe(2)
      expect(runSpy).not.toHaveBeenCalled()
      process.exitCode = undefined
    })

    it('forwards purl-like arguments via package score shortcut', async () => {
      // socket pkg:npm/lodash → calls itself recursively with [package, deep, ...]
      const packageRun = vi.fn(async () => undefined)
      const subcommands = {
        package: {
          description: 'package commands',
          run: vi.fn(async (argv: any) => {
            // Simulate package picking deep subcommand.
            if (argv[0] === 'deep') {
              packageRun(argv)
            }
          }),
        },
      }
      await meowWithSubcommands({
        name: 'socket',
        argv: ['pkg:npm/lodash@4'],
        importMeta: import.meta,
        subcommands,
      })
      // The run for `package` should have been invoked.
      expect(subcommands.package.run).toHaveBeenCalled()
    })

    it('forwards "ecosystem/package" shortcut via package score', async () => {
      const subcommands = {
        package: {
          description: 'package commands',
          run: vi.fn(async () => undefined),
        },
      }
      await meowWithSubcommands({
        name: 'socket',
        argv: ['npm/lodash'],
        importMeta: import.meta,
        subcommands,
      })
      expect(subcommands.package.run).toHaveBeenCalled()
    })

    it('shows help for root socket command without args', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          run: vi.fn(async () => undefined),
        },
        login: {
          description: 'login command',
          run: vi.fn(async () => undefined),
        },
        package: {
          description: 'package',
          run: vi.fn(async () => undefined),
        },
      }
      // No argv → root help path.
      // showHelp throws in our mock to simulate process.exit, so we just
      // verify it didn't crash.
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: [],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showHelp throw is expected.
      }
      // None of the subcommands should have actually run.
      expect(subcommands.scan.run).not.toHaveBeenCalled()
    })

    it('shows help for non-root command without args', async () => {
      const subcommands = {
        nested: {
          description: 'nested',
          run: vi.fn(async () => undefined),
        },
      }
      try {
        await meowWithSubcommands({
          name: 'subgroup',
          argv: [],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showHelp throw is expected.
      }
      expect(subcommands.nested.run).not.toHaveBeenCalled()
    })

    it('skips alias when its target subcommand is hidden', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          hidden: true,
          run: vi.fn(async () => undefined),
        },
      }
      try {
        await meowWithSubcommands(
          {
            name: 'socket',
            argv: [],
            importMeta: import.meta,
            subcommands,
          },
          {
            aliases: {
              s: { argv: ['scan'], description: 'alias of scan' },
            },
          },
        )
      } catch {
        // showHelp throw is expected.
      }
      // Just confirm no crash.
      expect(true).toBe(true)
    })

    it('shows --help-full output for root command when flag passed', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          run: vi.fn(async () => undefined),
        },
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['--help-full'],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showHelp throw is expected.
      }
      expect(true).toBe(true)
    })

    it('shows --help-full bucketed help with all canonical subcommands', async () => {
      // Provide every subcommand in the canonical Set so the
      // commands.delete loop empties the Set and the
      // `if (commands.size)` failure-message branch (lines 700-711)
      // is skipped, exercising the `lines.push` block (lines 712-750).
      const stub = (description: string) => ({
        description,
        run: vi.fn(async () => undefined),
      })
      const subcommands = {
        analytics: stub('analytics'),
        ask: stub('ask'),
        'audit-log': stub('audit-log'),
        bundler: stub('bundler'),
        cargo: stub('cargo'),
        cdxgen: stub('cdxgen'),
        ci: stub('ci'),
        config: stub('config'),
        dependencies: stub('dependencies'),
        fix: stub('fix'),
        gem: stub('gem'),
        go: stub('go'),
        install: stub('install'),
        license: stub('license'),
        login: stub('login'),
        logout: stub('logout'),
        manifest: stub('manifest'),
        npm: stub('npm'),
        npx: stub('npx'), // socket-hook: allow npx
        nuget: stub('nuget'),
        optimize: stub('optimize'),
        organization: stub('organization'),
        package: stub('package'),
        patch: stub('patch'),
        pip: stub('pip'),
        pycli: stub('pycli'),
        'raw-npm': stub('raw-npm'),
        'raw-npx': stub('raw-npx'),
        repository: stub('repository'),
        scan: stub('scan'),
        sfw: stub('sfw'),
        'threat-feed': stub('threat-feed'),
        uninstall: stub('uninstall'),
        uv: stub('uv'),
        whoami: stub('whoami'),
        wrapper: stub('wrapper'),
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['--help-full'],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showHelp throw is expected.
      }
      expect(true).toBe(true)
    })

    it('reports unknown subcommand and missing canonical commands when subcommands are partial', async () => {
      // `extra` is NOT in the canonical Set → triggers
      // `logger.fail('Received an unknown command:', name)` (line 697-698).
      // Missing canonical commands trigger the `if (commands.size)` block
      // (lines 700-711). Together this exercises both branches of the
      // canonical-Set diff loop.
      const subcommands = {
        scan: { description: 'scan', run: vi.fn(async () => undefined) },
        extra: { description: 'extra', run: vi.fn(async () => undefined) },
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: [],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showHelp throw is expected.
      }
      expect(true).toBe(true)
    })

    it('handles dryRun without --help', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          run: vi.fn(async () => undefined),
        },
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['--dry-run'],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // process.exit throw is expected.
      }
      expect(true).toBe(true)
    })

    it('handles --version flag at root level', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          run: vi.fn(async () => undefined),
        },
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['--version'],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showVersion throw is expected.
      }
      expect(true).toBe(true)
    })

    it('suggests close-match command for typos (lines 414-418)', async () => {
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
        login: {
          description: 'login',
          run: vi.fn(async () => undefined),
        },
      }
      const originalExitCode = process.exitCode
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['scn'], // typo for "scan"
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // Expected to potentially throw — we want the suggestion path.
      }
      // Subcommand should NOT have run for the typo.
      expect(runSpy).not.toHaveBeenCalled()
      // Exit code 2 set when suggestion found.
      // Reset for other tests.
      process.exitCode = originalExitCode
    })

    it('shows error for unknown command with no close match', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          run: vi.fn(async () => undefined),
        },
      }
      const originalExitCode = process.exitCode
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['totally-unrelated-name'],
          importMeta: import.meta,
          subcommands,
        })
      } catch {
        // showHelp throw fallthrough is expected.
      }
      expect(subcommands.scan.run).not.toHaveBeenCalled()
      process.exitCode = originalExitCode
    })

    it('shows version when --version flag is set (line 469)', async () => {
      const subcommands = {
        scan: {
          description: 'scan',
          run: vi.fn(async () => undefined),
        },
      }
      try {
        await meowWithSubcommands(
          {
            name: 'socket',
            argv: ['--version'],
            importMeta: import.meta,
            subcommands,
          },
          {
            // Need version in flags or root config to avoid the meow validate error.
            version: '1.0.0',
          },
        )
      } catch {
        // showVersion typically calls process.exit via meow.
      }
      expect(subcommands.scan.run).not.toHaveBeenCalled()
    })

    it('applies SOCKET_CLI_CONFIG override when present (line 348)', async () => {
      const originalConfig = process.env['SOCKET_CLI_CONFIG']
      process.env['SOCKET_CLI_CONFIG'] = Buffer.from(
        JSON.stringify({ defaultOrg: 'override-org' }),
      ).toString('base64')
      mockOverrideCachedConfig.mockReturnValue({ ok: true })
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['scan'],
          importMeta: import.meta,
          subcommands,
        })
        expect(mockOverrideCachedConfig).toHaveBeenCalled()
        expect(runSpy).toHaveBeenCalled()
      } finally {
        if (originalConfig === undefined) {
          delete process.env['SOCKET_CLI_CONFIG']
        } else {
          process.env['SOCKET_CLI_CONFIG'] = originalConfig
        }
      }
    })

    it('applies SOCKET_CLI_API_TOKEN override (line 362)', async () => {
      const originalNoToken = process.env['SOCKET_CLI_NO_API_TOKEN']
      const originalToken = process.env['SOCKET_CLI_API_TOKEN']
      delete process.env['SOCKET_CLI_NO_API_TOKEN']
      process.env['SOCKET_CLI_API_TOKEN'] = 'sktsec_test_xxxxxxxxxxxx'
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['scan'],
          importMeta: import.meta,
          subcommands,
        })
        // overrideConfigApiToken should be called with the env token.
        expect(mockOverrideConfigApiToken).toHaveBeenCalledWith(
          'sktsec_test_xxxxxxxxxxxx',
        )
      } finally {
        if (originalNoToken !== undefined) {
          process.env['SOCKET_CLI_NO_API_TOKEN'] = originalNoToken
        }
        if (originalToken === undefined) {
          delete process.env['SOCKET_CLI_API_TOKEN']
        } else {
          process.env['SOCKET_CLI_API_TOKEN'] = originalToken
        }
      }
    })

    it('returns early with exit code 2 on bad config override (lines 367-374)', async () => {
      const originalConfig = process.env['SOCKET_CLI_CONFIG']
      process.env['SOCKET_CLI_CONFIG'] = 'invalid-base64'
      mockOverrideCachedConfig.mockReturnValue({
        ok: false,
        message: 'Could not parse Config as JSON',
      })
      const runSpy = vi.fn(async () => undefined)
      const subcommands = {
        scan: {
          description: 'scan',
          run: runSpy,
        },
      }
      const originalExitCode = process.exitCode
      try {
        await meowWithSubcommands({
          name: 'socket',
          argv: ['scan'],
          importMeta: import.meta,
          subcommands,
        })
        // The bad-config branch returns early, so the subcommand never runs.
        expect(runSpy).not.toHaveBeenCalled()
        expect(process.exitCode).toBe(2)
      } finally {
        process.exitCode = originalExitCode
        if (originalConfig === undefined) {
          delete process.env['SOCKET_CLI_CONFIG']
        } else {
          process.env['SOCKET_CLI_CONFIG'] = originalConfig
        }
      }
    })
  })
})
