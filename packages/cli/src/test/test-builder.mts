/** @fileoverview Test builder utilities to DRY out repetitive test patterns */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Test stubs commented out - need to be reimplemented locally.
// import { spawn } from '@socketsecurity/registry/test/stubs/child-process'
// import { stubLoggerLog } from '@socketsecurity/registry/test/stubs/console'

import type { Mock } from 'vitest'

/**
 * Common test setup for CLI commands
 */
export interface TestSetupOptions {
  commandPath: string
  commandName: string
  parentCommand?: string
  mockSdk?: boolean
  mockConfig?: Record<string, any>
  env?: Record<string, string>
}

export function setupCommandTest(options: TestSetupOptions) {
  const {
    // Commented out to avoid unused variable errors.
    // commandPath,
    // commandName,
    // parentCommand,
    env = {},
    mockConfig = {},
    mockSdk = true,
  } = options

  const stubs = {
    // spawn: spawn as Mock, // Commented out - stub not available.
    loggerLog: null as Mock | null,
    sdk: {} as any,
    config: mockConfig,
  }

  // Expose mock SDK globally for tests to access
  ;(global as any).mockSdk = stubs.sdk

  beforeEach(() => {
    // Reset environment
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value
    }

    // Reset mock SDK for each test
    stubs.sdk = {} as any
    ;(global as any).mockSdk = stubs.sdk

    // Mock logger - commented out, stub not available.
    // stubs.loggerLog = stubLoggerLog()

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
  flags?: Record<string, any>
  expectedExitCode?: number
  expectedOutput?: string | RegExp | string[]
  expectedError?: string | RegExp
  setup?: () => void | Promise<void>
  validate?: (stubs: any) => void | Promise<void>
}

export function buildCommandTests(
  suiteName: string,
  setupOptions: TestSetupOptions,
  testCases: CommandTestCase[],
) {
  describe(suiteName, () => {
    const stubs = setupCommandTest(setupOptions)

    for (const testCase of testCases) {
      it(testCase.name, async () => {
        // Run setup if provided
        if (testCase.setup) {
          await testCase.setup()
        }

        // Build command arguments
        const args = [...testCase.args]
        if (testCase.flags) {
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
      const output = stubs.loggerLog?.mock.calls
        .map((call: any[]) => call[0])
        .join('')
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
export function mockApiResponse<T>(sdk: any, method: string, response: T) {
  sdk[method] = vi.fn().mockResolvedValue({
    ok: true,
    data: response,
  })
}

export function mockApiError(sdk: any, method: string, error: string) {
  sdk[method] = vi.fn().mockResolvedValue({
    ok: false,
    message: error,
  })
}
