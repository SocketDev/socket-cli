import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../src/constants.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Note: the fixture dir is in the same dir as this utils file
const npmFixturesPath = path.join(__dirname, 'socket-npm-fixtures')

type TestCollectorOptions = Exclude<Parameters<typeof it>[1], undefined>

/**
 * This is a simple template wrapper for this pattern:
 * `it('should do: socket scan', (['socket', 'scan']) => {})`
 */
export function cmdit(
  cmd: string[],
  title: string,
  cb: (cmd: string[]) => Promise<void>,
  options?: TestCollectorOptions | undefined
) {
  it(
    `${title}: \`${cmd.join(' ')}\``,
    {
      timeout: 30_000,
      ...options
    },
    cb.bind(null, cmd)
  )
}

export async function invokeNpm(
  entryPath: string,
  args: string[],
  env = {}
): Promise<{
  status: boolean
  code: number
  stdout: string
  stderr: string
}> {
  try {
    const thing = await spawn(
      // Lazily access constants.execPath.
      constants.execPath,
      [entryPath, ...args],
      {
        cwd: npmFixturesPath,
        env: { ...process.env, ...env }
      }
    )
    return {
      status: true,
      code: 0,
      stdout: toAsciiSafeString(normalizeLogSymbols(thing.stdout)),
      stderr: toAsciiSafeString(normalizeLogSymbols(thing.stderr))
    }
  } catch (e: any) {
    return {
      status: false,
      code: e?.code,
      stdout: toAsciiSafeString(normalizeLogSymbols(e?.stdout ?? '')),
      stderr: toAsciiSafeString(normalizeLogSymbols(e?.stderr ?? ''))
    }
  }
}

function normalizeLogSymbols(str: string): string {
  return str
    .replaceAll('✖️', '×')
    .replaceAll('ℹ', 'i')
    .replaceAll('✔', '√')
    .replaceAll('⚠', '‼')
}

function toAsciiSafeString(str: string): string {
  // eslint-disable-next-line no-control-regex
  const asciiSafeRegex = /[\u0000-\u0007\u0009\u000b-\u001f\u0080-\uffff]/g
  return str.replace(asciiSafeRegex, (m: string) => {
    const code = m.charCodeAt(0)
    return code < 255
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`
  })
}
