/** Dependency-free synchronous spawn helper adapted from registry spawn (MIT). */
import childProcess from 'node:child_process'
import path from 'node:path'

import type { SpawnSyncOptions } from './spawn.mts'

const windowsScriptExtRegExp = /\.(?:cmd|bat|ps1)$/i

const ansiRegExp =
  // eslint-disable-next-line no-control-regex -- The expression removes ANSI control codes.
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C)|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g

export function spawnSync(
  command: string,
  args?: string[] | readonly string[],
  options?: SpawnSyncOptions,
): childProcess.SpawnSyncReturns<string | Buffer> {
  const shell = options?.shell
  if (
    process.platform === 'win32' &&
    shell &&
    windowsScriptExtRegExp.test(command)
  ) {
    command = path.basename(command, path.extname(command))
  }
  const { stripAnsi = true, ...rawOptions } = { ...options }
  const stdioString = rawOptions.stdioString !== false
  const result = childProcess.spawnSync(command, args, {
    encoding: stdioString ? 'utf8' : 'buffer',
    ...rawOptions,
  })
  if (stdioString) {
    if (result.stdout) {
      result.stdout = result.stdout.toString().trim()
    }
    if (result.stderr) {
      result.stderr = result.stderr.toString().trim()
    }
    if (stripAnsi) {
      if (typeof result.stdout === 'string') {
        result.stdout = result.stdout.replace(ansiRegExp, '')
      }
      if (typeof result.stderr === 'string') {
        result.stderr = result.stderr.replace(ansiRegExp, '')
      }
    }
  }
  return result as childProcess.SpawnSyncReturns<string | Buffer>
}
