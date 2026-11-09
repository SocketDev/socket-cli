import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { it } from 'vitest'

import { type SpawnOptions, spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants, {
  COANA_CLI_VERSION,
  FLAG_HELP,
  FLAG_VERSION,
} from '../src/constants.mts'

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

// Normalize Coana version to a placeholder for stable snapshots.
function normalizeCoanaVersion(str: string): string {
  return str.replaceAll(COANA_CLI_VERSION, '<coana-version>')
}

// Normalize CLI banner output for stable snapshots.
// The banner contains environment-specific values (version, token, org, cwd)
// that differ across machines and CI environments.
function normalizeBanner(str: string): string {
  return (
    str
      // Child CLI processes inherit CI but not Vitest's in-process marker, so
      // they use the compact CI header. Normalize both header styles to the
      // same snapshot shape.
      .replace(
        /^[ \t]*CLI: [^|\n]+ \| cmd: ([^|\n]+) \| org: [^|\n]+ \| token: [^\n"]+$/gm,
        (_match, command: string) =>
          `_____         _       _        /---------------\n` +
          `  |   __|___ ___| |_ ___| |_      | CLI: <redacted>\n` +
          `  |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>\n` +
          `  |_____|___|___|_,_|___|_|.dev   | Command: \`${command.trim()}\`, cwd: <redacted>`,
      )
      // Replace a version like "v1.1.67" or "v2.1.0-pre-release.0" with
      // "<redacted>" - also matches an already-redacted value, since whether
      // the CLI itself redacts depends on env baked in at build time, not
      // just this test run.
      .replace(
        /\| CLI: (?:v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|<redacted>)/g,
        '| CLI: <redacted>',
      )
      // Replace token and org info with "<redacted>".
      .replace(
        /\| (?:Node: [^,]+, )?token: [^,]+, (?:org: [^\n"]+)/g,
        '| token: <redacted>, org: <redacted>',
      )
      // Replace cwd path with "<redacted>".
      .replace(/cwd: [^\n"]+/g, 'cwd: <redacted>')
  )
}

function normalizeEnvironmentPaths(str: string): string {
  const homeRelativeCwd = path.relative(os.homedir(), process.cwd())
  const homeRelativePrefix = homeRelativeCwd
    ? `~/${homeRelativeCwd.split(path.sep).join('/')}`
    : '~'
  const prefixes = [...new Set([process.cwd(), homeRelativePrefix])]
  return prefixes.reduce((result, prefix) => {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return result.replace(
      new RegExp(`${escapedPrefix}[^\\s"'<>:]*`, 'g'),
      '<redacted>',
    )
  }, str)
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
    normalizeBanner(
      normalizeCoanaVersion(
        normalizeLogSymbols(
          normalizeEnvironmentPaths(
            normalizeNewlines(stripZeroWidthSpace(stripAnsi(output.trim()))),
          ),
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
  options?: (SpawnOptions & { timeout?: number | undefined }) | undefined,
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
    signal: callerSignal,
    timeout,
    ...spawnOptions
  } = {
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
    const nativeBinary = process.env['SOCKET_CLI_NATIVE_TEST_BINARY']
    const nativeStage = process.env['SOCKET_CLI_NATIVE_TEST_STAGE']
    const executionEnv = {
      ...cleanEnv,
      ...cleanProcessEnv,
      ...spawnEnv,
    }
    if (nativeStage) {
      executionEnv['npm_config_cache'] = path.join(nativeStage, 'npm-cache')
      executionEnv['npm_config_cache_dir'] = path.join(
        nativeStage,
        'pnpm-cache',
      )
      executionEnv['npm_config_store_dir'] = path.join(
        nativeStage,
        'pnpm-store',
      )
      executionEnv['npm_config_userconfig'] = path.join(nativeStage, 'npmrc')
      executionEnv['npm_config_globalconfig'] = path.join(
        nativeStage,
        'global-npmrc',
      )
      executionEnv['PNPM_HOME'] = path.join(nativeStage, 'pnpm-home')
      executionEnv['XDG_CONFIG_HOME'] = path.join(nativeStage, 'xdg-config')
      executionEnv['XDG_CACHE_HOME'] = path.join(nativeStage, 'xdg-cache')
      executionEnv['XDG_DATA_HOME'] = path.join(nativeStage, 'xdg-data')
      executionEnv['HOME'] = path.join(nativeStage, 'home')
      executionEnv['USERPROFILE'] = path.join(nativeStage, 'home')
      executionEnv['LOCALAPPDATA'] = path.join(nativeStage, 'AppData', 'Local')
      executionEnv['APPDATA'] = path.join(nativeStage, 'AppData', 'Roaming')
      executionEnv['TMPDIR'] = path.join(nativeStage, 'tmp')
      executionEnv['TMP'] = path.join(nativeStage, 'tmp')
      executionEnv['TEMP'] = path.join(nativeStage, 'tmp')
    }
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) {
      abortFromCaller()
    } else {
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    }
    const timeoutHandle =
      typeof timeout === 'number' && timeout > 0
        ? setTimeout(
            () =>
              controller.abort(new Error(`CLI timed out after ${timeout}ms`)),
            timeout,
          )
        : undefined
    timeoutHandle?.unref()
    let command = constants.execPath
    let commandArgs = [entryPath, ...args]
    if (nativeBinary) {
      command = nativeBinary
      commandArgs = args
    }
    const child = spawn(command, commandArgs, {
      ...spawnOptions,
      cwd,
      env: executionEnv,
      signal: controller.signal,
    })
    const waitForChildClose = async () => {
      const process = child.process
      if (process.exitCode !== null || process.signalCode !== null) {
        return
      }
      await new Promise<void>(resolve => process.once('close', () => resolve()))
    }
    let output
    try {
      output = await child
    } catch (error) {
      await waitForChildClose()
      throw error
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }
    return {
      status: true,
      code: 0,
      stdout: cleanOutput(output.stdout),
      stderr: cleanOutput(output.stderr),
    }
  } catch (e: unknown) {
    return {
      status: false,
      code: typeof e?.['code'] === 'number' ? e['code'] : 1,
      error: {
        message: e?.['message'] || '',
        stack: e?.['stack'] || '',
      },
      stdout: cleanOutput(e?.['stdout'] ?? ''),
      stderr: cleanOutput(e?.['stderr'] ?? ''),
    }
  }
}
