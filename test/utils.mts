import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import constants from '../src/constants.mts'

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

export async function invokeNpm(
  entryPath: string,
  args: string[],
  spawnEnv = {},
  cwd = testPath,
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
  try {
    const output = await spawn(constants.execPath, [entryPath, ...args], {
      cwd,
      env: {
        ...process.env,
        ...constants.processEnv,
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
