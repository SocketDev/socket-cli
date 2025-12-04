import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { it } from 'vitest'

import { SpawnOptions, spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants, { FLAG_HELP, FLAG_VERSION } from '../src/constants.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Read Coana version from package.json for test normalization.
// This is needed because constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION
// is a compile-time value that's empty in the test environment.
const rootPackageJson = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
) as { devDependencies: Record<string, string> }
const coanaVersion = rootPackageJson.devDependencies['@coana-tech/cli'] ?? ''

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

// Normalize Coana version to a placeholder for stable snapshots.
function normalizeCoanaVersion(str: string): string {
  if (!coanaVersion) {
    return str
  }
  return str.replaceAll(coanaVersion, '<coana-version>')
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
    normalizeCoanaVersion(
      normalizeLogSymbols(
        normalizeNewlines(stripZeroWidthSpace(stripAnsi(output.trim()))),
      ),
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
    // Exclude Socket auth credentials to ensure tests run unauthenticated.
    const {
      SOCKET_CLI_API_BASE_URL: unusedApiBaseUrl,
      SOCKET_CLI_API_KEY: unusedCliApiKey,
      SOCKET_CLI_API_TOKEN: unusedCliApiToken,
      SOCKET_CLI_ORG_SLUG: unusedOrgSlug,
      SOCKET_SECURITY_API_KEY: unusedApiKey,
      SOCKET_SECURITY_API_TOKEN: unusedSecurityApiToken,
      ...cleanEnv
    } = process.env
    const {
      SOCKET_CLI_API_BASE_URL: unusedProcessApiBaseUrl,
      SOCKET_CLI_API_KEY: unusedProcessCliApiKey,
      SOCKET_CLI_API_TOKEN: unusedProcessCliApiToken,
      SOCKET_CLI_ORG_SLUG: unusedProcessOrgSlug,
      SOCKET_SECURITY_API_KEY: unusedProcessApiKey,
      SOCKET_SECURITY_API_TOKEN: unusedProcessSecurityApiToken,
      ...cleanProcessEnv
    } = constants.processEnv
    const output = await spawn(constants.execPath, [entryPath, ...args], {
      cwd,
      env: {
        ...cleanEnv,
        ...cleanProcessEnv,
        ...spawnEnv,
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
