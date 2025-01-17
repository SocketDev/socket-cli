// An implementation of https://socket.dev/npm/package/@npmcli/promise-spawn/overview/8.0.2
// that uses child_process.fork instead of child_process.spawn.
// ISC License
// Copyright (c) npm, Inc.
import { fork as builtinFork } from 'node:child_process'

import type { ForkOptions as BuiltinForkOptions } from 'node:child_process'

type BuiltinForkResult = ReturnType<typeof builtinFork>

export type ForkOptions = {
  cwd?: string
  encoding?: BufferEncoding
  stdioString?: boolean
} & BuiltinForkOptions

export type ForkResult<Output, Extra> = Promise<
  {
    cmd: string
    args: string[]
    code: number
    signal: NodeJS.Signals | null
    stdout: Output
    stderr: Output
  } & Extra
> & { process: BuiltinForkResult; stdio: BuiltinForkResult['stdio'] }

export function fork<O extends ForkOptions>(
  cmd: string,
  args: string[],
  opts?: O,
  extra?: Record<any, any>
): ForkResult<
  O extends { stdioString: false } ? Buffer : string,
  typeof extra
> {
  const { encoding = 'utf8', ...builtinForkOptions } = {
    __proto__: null,
    ...opts
  }

  let resolve: ((value: any) => void) | undefined
  let reject: ((reason?: any) => void) | undefined
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  }) as ForkResult<
    O extends { stdioString: false } ? Buffer : string,
    typeof extra
  >

  const closeError = new Error('command failed')
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []

  const getResult = (result: Record<string, any>) => ({
    cmd,
    args,
    ...result,
    stdout: Buffer.concat(stdout).toString(encoding),
    stderr: Buffer.concat(stderr).toString(encoding),
    ...extra
  })

  const rejectWithOpts = (er: Error, erOpts: Record<string, any>) => {
    const resultError = getResult(erOpts)
    reject?.(Object.assign(er, resultError))
  }

  const proc = builtinFork(cmd, args, builtinForkOptions)
    .on('error', error => rejectWithOpts(error, {}))
    .on('close', (code, signal) => {
      if (code !== 0 || signal) {
        rejectWithOpts(closeError, { code, signal })
      } else {
        resolve?.(getResult({ code, signal }))
      }
    })
  proc.stdout
    ?.on('data', chunk => stdout.push(chunk))
    .on('error', error => rejectWithOpts(error, {}))
  proc.stderr
    ?.on('data', chunk => stderr.push(chunk))
    .on('error', error => rejectWithOpts(error, {}))
  ;(promise as any).stdin = proc.stdin
  ;(promise as any).process = proc
  return promise
}
