/** @fileoverview Test builder utilities to DRY out repetitive test patterns */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Mock } from 'vitest'

declare global {
  // Test-only global used to expose the mock SDK to command modules under test.
  // eslint-disable-next-line no-var
  var mockSdk: Record<string, unknown> | undefined
}

/**
 * Common test setup for CLI commands
 */
export interface TestSetupOptions {
  commandPath: string
  commandName: string
  parentCommand?: string
  mockSdk?: boolean
  mockConfig?: Record<string, unknown>
  env?: Record<string, string>
}

export interface TestStubs {
  loggerLog: Mock | undefined
  sdk: Record<string, unknown>
  config: Record<string, unknown>
}

export function setupCommandTest(options: TestSetupOptions): TestStubs {
  const {
    // Commented out to avoid unused variable errors.
    // commandPath,
    // commandName,
    // parentCommand,
    env = {},
    mockConfig = {},
    mockSdk = true,
  } = options

  const stubs: TestStubs = {
    loggerLog: undefined,
    sdk: {},
    config: mockConfig,
  }

  // Expose mock SDK globally for tests to access
  globalThis.mockSdk = stubs.sdk

  beforeEach(() => {
    // Reset environment
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value
    }

    // Reset mock SDK for each test
    stubs.sdk = {}
    globalThis.mockSdk = stubs.sdk

    // Mock SDK if needed
    if (mockSdk) {
      vi.mock('../../utils/socket/sdk.mjs', () => ({
        hasDefaultApiToken: vi.fn(() => true),
        setupSdk: vi.fn(() => ({ ok: true, data: stubs.sdk })),
      }))
    }

    // Mock config
    vi.mock('../../utils/config.mts', () => ({
      getConfigValueOrUndef: vi.fn((key: string) => mockConfig[key]),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    // Clean up environment
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const key of Object.keys(env)) {
      delete process.env[key]
    }
  })

  return stubs
}

/**
 * Test builder for CLI commands
 */
export interface CommandTestCase {
  name: string
  args: string[]
  flags?: Record<string, unknown>
  expectedExitCode?: number
  expectedOutput?: string | RegExp | string[]
  expectedError?: string | RegExp
  setup?: () => void | Promise<void>
  validate?: (stubs: TestStubs) => void | Promise<void>
}

export function buildCommandTests(
  suiteName: string,
  setupOptions: TestSetupOptions,
  testCases: CommandTestCase[],
) {
  describe(suiteName, () => {
    const stubs = setupCommandTest(setupOptions)

    for (let i = 0, { length } = testCases; i < length; i += 1) {
      const testCase = testCases[i]!
      it(testCase.name, async () => {
        // Run setup if provided
        if (testCase.setup) {
          await testCase.setup()
        }

        // Build command arguments
        const args = [...testCase.args]
        if (testCase.flags) {
          // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
          for (const [flag, value] of Object.entries(testCase.flags)) {
            if (value === true) {
              args.push(`--${flag}`)
            } else if (value !== false) {
              args.push(`--${flag}`, String(value))
            }
          }
        }

        // Import and run command
        const module = await import(setupOptions.commandPath)
        const command = module[setupOptions.commandName]

        // Run command
        await command.run(args, import.meta, {
          parentName: setupOptions.parentCommand || 'socket',
        })

        // Check exit code
        if (testCase.expectedExitCode !== undefined) {
          expect(process.exitCode).toBe(testCase.expectedExitCode)
        }

        // Check output
        if (testCase.expectedOutput) {
          const output = stubs.loggerLog?.mock.calls
            .map(call => call[0])
            .join('\n')
          if (Array.isArray(testCase.expectedOutput)) {
            // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
            for (const expected of testCase.expectedOutput) {
              expect(output).toContain(expected)
            }
          } else if (testCase.expectedOutput instanceof RegExp) {
            expect(output).toMatch(testCase.expectedOutput)
          } else {
            expect(output).toContain(testCase.expectedOutput)
          }
        }

        // Check error
        if (testCase.expectedError) {
          const errors = stubs.loggerLog?.mock.calls
            .filter(
              call =>
                call[0]?.includes?.('error') || call[0]?.includes?.('Error'),
            )
            .map(call => call[0])
            .join('\n')

          if (testCase.expectedError instanceof RegExp) {
            expect(errors).toMatch(testCase.expectedError)
          } else {
            expect(errors).toContain(testCase.expectedError)
          }
        }

        // Run custom validation
        if (testCase.validate) {
          await testCase.validate(stubs)
        }
      })
    }
  })
}

/**
 * Common test patterns
 */
export const commonTests = {
  /**
   * Test help output
   */
  help: (commandName: string): CommandTestCase => ({
    name: 'should show help',
    args: ['--help'],
    expectedOutput: ['Usage', commandName],
    expectedExitCode: 0,
  }),

  /**
   * Test JSON output
   */
  jsonOutput: (): CommandTestCase => ({
    name: 'should output JSON',
    args: [],
    flags: { json: true },
    validate: stubs => {
      const output =
        stubs.loggerLog?.mock.calls
          .map((call: unknown[]) => call[0])
          .join('') ?? ''
      expect(() => JSON.parse(output)).not.toThrow()
    },
  }),

  /**
   * Test dry-run
   */
  dryRun: (): CommandTestCase => ({
    name: 'should handle dry-run',
    args: [],
    flags: { dryRun: true },
    expectedOutput: 'Dry run',
    expectedExitCode: 0,
  }),

  /**
   * Test missing auth
   */
  missingAuth: (): CommandTestCase => ({
    name: 'should fail without auth',
    args: [],
    setup: () => {
      vi.mocked(
        require('../../utils/socket/sdk.mjs').hasDefaultApiToken,
      ).mockReturnValue(false)
    },
    expectedError: /login/,
    expectedExitCode: 1,
  }),

  /**
   * Test missing required argument
   */
  missingArg: (argName: string): CommandTestCase => ({
    name: `should fail without ${argName}`,
    args: [],
    expectedError: new RegExp(argName),
    expectedExitCode: 1,
  }),
}

/**
 * Mock API responses
 */
export function mockApiResponse<T>(
  sdk: Record<string, unknown>,
  method: string,
  response: T,
) {
  sdk[method] = vi.fn().mockResolvedValue({
    ok: true,
    data: response,
  })
}

export function mockApiError(
  sdk: Record<string, unknown>,
  method: string,
  error: string,
) {
  sdk[method] = vi.fn().mockResolvedValue({
    ok: false,
    message: error,
  })
}
