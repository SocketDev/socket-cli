import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { it, vi } from 'vitest'

import { SpawnOptions, spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants, { FLAG_HELP, FLAG_VERSION } from '../src/constants.mts'

import type { SetupSdkResult } from '../src/utils/sdk.mts'
import type { MockedFunction } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The asciiUnsafeRegexp match characters that are:
//   * Control characters in the Unicode range:
//     - \u0000 to \u0007 (e.g., NUL, BEL)
//     - \u0009 (Tab, but note: not \u0008 Backspace or \u000A Newline)
//     - \u000B to \u001F (other non-printable control characters)
//   * All non-ASCII characters:
//     - \u0080 to \uFFFF (extended Unicode)
// eslint-disable-next-line no-control-regex
const asciiUnsafeRegexp = /[\u0000-\u0007\u0009\u000b-\u001f\u0080-\uffff]/g

// Note: The fixture directory is in the same directory as this utils file.
export const testPath = __dirname

function normalizeLogSymbols(str: string): string {
  return str
    .replaceAll('✖', '×')
    .replaceAll('ℹ', 'i')
    .replaceAll('✔', '√')
    .replaceAll('⚠', '‼')
}

function normalizeNewlines(str: string): string {
  return (
    str
      // Replace all literal \r\n.
      .replaceAll('\r\n', '\n')
      // Replace all escaped \\r\\n.
      .replaceAll('\\r\\n', '\\n')
  )
}

function stripZeroWidthSpace(str: string): string {
  return str.replaceAll('\u200b', '')
}

function toAsciiSafeString(str: string): string {
  return str.replace(asciiUnsafeRegexp, m => {
    const code = m.charCodeAt(0)
    return code < 255
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`
  })
}

export function cleanOutput(output: string): string {
  return toAsciiSafeString(
    normalizeLogSymbols(
      normalizeNewlines(stripZeroWidthSpace(stripAnsi(output.trim()))),
    ),
  )
}

/**
 * Check if output contains cdxgen help content.
 * Used to verify cdxgen command executed with help flag.
 */
export function hasCdxgenHelpContent(output: string): boolean {
  // Check for various cdxgen help indicators.
  // Must have cdxgen or CycloneDX AND at least one help flag indicator.
  const hasCdxgenMention =
    output.includes('CycloneDX') || output.includes('cdxgen')
  const hasHelpFlags =
    output.includes(FLAG_HELP) ||
    output.includes(FLAG_VERSION) ||
    // cdxgen-specific flags.
    output.includes('--output') ||
    output.includes('--type')

  return hasCdxgenMention && hasHelpFlags
}

/**
 * Check if output contains the Socket CLI banner.
 * The banner appears as ASCII art in the stderr output.
 * Note: The banner contains either '*' (when --config is used) or '.' (when no config is used).
 */
export function hasSocketBanner(output: string): boolean {
  // Check for Socket banner ASCII art lines.
  // The banner is always printed as a complete block, never partial.
  // Just check for the most distinctive first line.
  return output.includes('_____         _       _')
}

export type TestCollectorOptions = Exclude<Parameters<typeof it>[1], undefined>

/**
 * This is a simple template wrapper for this pattern:
 * `it('should do: socket scan', (['socket', 'scan']) => {})`
 */
export function cmdit(
  cmd: string[],
  title: string,
  cb: (cmd: string[]) => Promise<void>,
  options?: TestCollectorOptions | undefined,
) {
  it(
    `${title}: \`${cmd.join(' ')}\``,
    {
      timeout: 30_000,
      ...options,
    },
    cb.bind(null, cmd),
  )
}

export async function spawnSocketCli(
  entryPath: string,
  args: string[],
  options?: SpawnOptions | undefined,
): Promise<{
  code: number
  error?: {
    message: string
    stack: string
  }
  status: boolean
  stdout: string
  stderr: string
}> {
  const { cwd = process.cwd(), env: spawnEnv } = {
    __proto__: null,
    ...options,
  } as SpawnOptions
  try {
    const output = await spawn(constants.execPath, [entryPath, ...args], {
      cwd,
      env: {
        ...process.env,
        ...constants.processEnv,
        ...spawnEnv,
        // Ensure test environment variables are passed to spawned processes.
        // These must be last to override any previous settings.
        VITEST: '1',
        NODE_ENV: 'test',
        SOCKET_CLI_DEBUG: 'false',
        DEBUG: 'false',
      },
    })
    return {
      status: true,
      code: 0,
      stdout: cleanOutput(output.stdout),
      stderr: cleanOutput(output.stderr),
    }
  } catch (e: unknown) {
    return {
      status: false,
      code: e?.['code'] || 1,
      error: {
        message: e?.['message'] || '',
        stack: e?.['stack'] || '',
      },
      stdout: cleanOutput(e?.['stdout'] ?? ''),
      stderr: cleanOutput(e?.['stderr'] ?? ''),
    }
  }
}

/**
 * Setup SDK mock that returns a successful result.
 * Use this helper to avoid repetitive mock setup in tests.
 */
export function mockSetupSdkSuccess(
  mockSetupSdk: MockedFunction<any>,
  sdkData: any = {},
): void {
  mockSetupSdk.mockResolvedValue({ ok: true, data: sdkData } as SetupSdkResult)
}

/**
 * Setup SDK mock that returns an error result.
 * Use this helper when testing SDK setup failures.
 */
export function mockSetupSdkFailure(
  mockSetupSdk: MockedFunction<any>,
  error: { code: number; message: string; cause?: string },
): void {
  mockSetupSdk.mockResolvedValue({
    ok: false,
    ...error,
  } as SetupSdkResult)
}

/**
 * Setup queryApiJson mock that returns a successful result.
 * The SDK and path parameters are ignored in the mock.
 */
export function mockQueryApiJsonSuccess<T = any>(
  mockQueryApiJson: MockedFunction<any>,
  data: T,
): void {
  mockQueryApiJson.mockResolvedValue({ ok: true, data })
}

/**
 * Setup queryApiJson mock that returns an error result.
 */
export function mockQueryApiJsonFailure(
  mockQueryApiJson: MockedFunction<any>,
  error: { code?: number; message?: string; error?: string },
): void {
  mockQueryApiJson.mockResolvedValue({
    ok: false,
    ...error,
  })
}

/**
 * Create mocks for SDK utilities. Returns mocked functions ready to use.
 * Use this at the top of your test to get both setupSdk and queryApiJson mocks.
 *
 * @example
 * const { mockSetupSdk, mockQueryApiJson } = await getMockedSdkUtils()
 * mockSetupSdkSuccess(mockSetupSdk)
 * mockQueryApiJsonSuccess(mockQueryApiJson, { some: 'data' })
 */
export async function getMockedSdkUtils() {
  const { queryApiJson, setupSdk } = await import('../src/utils/sdk.mts')
  return {
    mockSetupSdk: vi.mocked(setupSdk),
    mockQueryApiJson: vi.mocked(queryApiJson),
  }
}
