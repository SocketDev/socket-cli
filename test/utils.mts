import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type SpawnOptions, spawn } from '@socketsecurity/lib/spawn'
import { stripAnsi } from '@socketsecurity/lib/strings'
import { it } from 'vitest'

import constants, { FLAG_HELP, FLAG_VERSION } from '../src/constants.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The asciiUnsafeRegexp match characters that are:
//   * Control characters in the Unicode range:
//     - \u0000 to \u0007 (e.g., NUL, BEL)
//     - \u0009 (Tab, but note: not \u0008 Backspace or \u000A Newline)
//     - \u000B to \u001F (other non-printable control characters)
//   * All non-ASCII characters:
//     - \u0080 to \uFFFF (extended Unicode)

const asciiUnsafeRegexp = /[\u0000-\u0007\u0009\u000b-\u001f\u0080-\uffff]/g

// Note: The fixture directory is in the same directory as this utils file.
export const testPath = __dirname

// Optimize fixture paths for package manager integration tests
export const OPTIMIZE_FIXTURE_PATH = path.join(testPath, 'fixtures/optimize')
export const PNPM_V8_FIXTURE = path.join(OPTIMIZE_FIXTURE_PATH, 'pnpm-v8')
export const PNPM_V9_FIXTURE = path.join(OPTIMIZE_FIXTURE_PATH, 'pnpm-v9')
export const PNPM_V10_FIXTURE = path.join(OPTIMIZE_FIXTURE_PATH, 'pnpm-v10')
export const YARN_CLASSIC_FIXTURE = path.join(
  OPTIMIZE_FIXTURE_PATH,
  'yarn-classic',
)
export const YARN_BERRY_FIXTURE = path.join(OPTIMIZE_FIXTURE_PATH, 'yarn-berry')
export const BUN_FIXTURE = path.join(OPTIMIZE_FIXTURE_PATH, 'bun')
export const VLT_FIXTURE = path.join(OPTIMIZE_FIXTURE_PATH, 'vlt')

// Agent fixture paths with installed package managers
export const AGENT_FIXTURE_PATH = path.join(testPath, 'fixtures/agent')
export const PNPM_V8_AGENT_FIXTURE = path.join(AGENT_FIXTURE_PATH, 'pnpm-v8')
export const PNPM_V9_AGENT_FIXTURE = path.join(AGENT_FIXTURE_PATH, 'pnpm-v9')
export const PNPM_V10_AGENT_FIXTURE = path.join(AGENT_FIXTURE_PATH, 'pnpm-v10')
export const YARN_CLASSIC_AGENT_FIXTURE = path.join(
  AGENT_FIXTURE_PATH,
  'yarn-classic',
)
export const YARN_BERRY_AGENT_FIXTURE = path.join(
  AGENT_FIXTURE_PATH,
  'yarn-berry',
)
export const BUN_AGENT_FIXTURE = path.join(AGENT_FIXTURE_PATH, 'bun')
export const VLT_AGENT_FIXTURE = path.join(AGENT_FIXTURE_PATH, 'vlt')

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

function stripTokenErrorMessages(str: string): string {
  // Remove API token error messages to avoid snapshot inconsistencies
  // when local environment has/doesn't have tokens set.
  return str.replace(
    /^\s*[×✖]\s+This command requires a Socket API token for access.*$/gm,
    '',
  )
}

function sanitizeTokens(str: string): string {
  // Sanitize Socket API tokens to prevent leaking credentials into snapshots.
  // Socket tokens follow the format: sktsec_[alphanumeric+underscore characters]

  // Match Socket API tokens: sktsec_ followed by word characters
  const tokenPattern = /sktsec_\w+/g
  let result = str.replace(tokenPattern, 'sktsec_REDACTED_TOKEN')

  // Sanitize token values in JSON-like structures
  result = result.replace(
    /"apiToken"\s*:\s*"sktsec_[^"]+"/g,
    '"apiToken":"sktsec_REDACTED_TOKEN"',
  )

  // Sanitize token prefixes that might be displayed (e.g., "zP416" -> "REDAC")
  // Match 5-character alphanumeric strings that appear after "token:" labels
  result = result.replace(
    /token:\s*\[?\d+m\]?([A-Za-z0-9]{5})\*{3}/gi,
    'token: REDAC***',
  )

  return result
}

export function cleanOutput(output: string): string {
  return toAsciiSafeString(
    normalizeLogSymbols(
      normalizeNewlines(
        stripZeroWidthSpace(
          sanitizeTokens(stripTokenErrorMessages(stripAnsi(output.trim()))),
        ),
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
  const {
    cwd = process.cwd(),
    env: spawnEnv,
    ...restOptions
  } = {
    __proto__: null,
    ...options,
  } as SpawnOptions

  // Detect if entryPath is a standalone binary (not a JS file).
  // Binaries include: yao-pkg, SEA, or any executable without JS extension.
  const isJsFile =
    entryPath.endsWith('.js') ||
    entryPath.endsWith('.mjs') ||
    entryPath.endsWith('.cjs') ||
    entryPath.endsWith('.mts') ||
    entryPath.endsWith('.ts')

  // For binaries, execute directly. For JS files, run through Node.
  const command = isJsFile ? constants.execPath : entryPath
  const commandArgs = isJsFile ? [entryPath, ...args] : args

  try {
    const output = await spawn(command, commandArgs, {
      cwd,
      env: {
        ...process.env,
        ...constants.processEnv,
        ...spawnEnv,
      },
      ...restOptions,
      // Close stdin to prevent tests from hanging
      // when commands wait for input. Must be after restOptions
      // to ensure it's not overridden.
      stdio: restOptions.stdio ?? ['ignore', 'pipe', 'pipe'],
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
      code: typeof e?.code === 'number' ? e.code : 1,
      error: {
        message: e?.message || '',
        stack: e?.stack || '',
      },
      stdout: cleanOutput(e?.stdout ?? ''),
      stderr: cleanOutput(e?.stderr ?? ''),
    }
  }
}
