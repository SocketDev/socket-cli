// An implementation of https://socket.dev/npm/package/@npmcli/promise-spawn/overview/8.0.2
// that uses child_process.fork instead of child_process.spawn.
// ISC License
// Copyright (c) npm, Inc.
import { fork as builtinFork } from 'node:child_process'

import type {
  ForkOptions as BuiltinForkOptions,
  StdioOptions
} from 'node:child_process'

type BuiltinForkResult = ReturnType<typeof builtinFork>

export type ForkOptions = {
  cwd?: string
  encoding?: BufferEncoding
  stdioString?: boolean | undefined
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

function isPipe(stdio: StdioOptions = 'pipe', fd: number) {
  if (stdio === 'pipe' || stdio === null) {
    return true
  }
  if (Array.isArray(stdio)) {
    return isPipe((stdio as any)[fd], fd)
  }
  return false
}

function stdioResult(
  stdout: Buffer<ArrayBufferLike>[],
  stderr: Buffer<ArrayBufferLike>[],
  {
    stdio,
    stdioString = true
  }: { stdioString?: boolean | undefined; stdio?: StdioOptions | undefined }
) {
  const result: {
    stdout: Buffer<ArrayBufferLike> | string | null
    stderr: Buffer<ArrayBufferLike> | string | null
  } = {
    stdout: null,
    stderr: null
  }
  // stdio is [stdin, stdout, stderr]
  if (isPipe(stdio, 1)) {
    result.stdout = Buffer.concat(stdout)
    if (stdioString) {
      result.stdout = result.stdout.toString().trim()
    }
  }
  if (isPipe(stdio, 2)) {
    result.stderr = Buffer.concat(stderr)
    if (stdioString) {
      result.stderr = result.stderr.toString().trim()
    }
  }
  return result
}

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
    ...stdioResult(stdout, stderr, builtinForkOptions),
    ...extra
  })

  const rejectWithOpts = (er: Error, erOpts: Record<string, any>) => {
    const resultError = getResult(erOpts)
    reject?.(Object.assign(er, resultError))
  }

  const proc = builtinFork(cmd, args, builtinForkOptions)
    .on('error', rejectWithOpts)
    .on('close', (code, signal) => {
      if (code || signal) {
        rejectWithOpts(closeError, { code, signal })
      } else {
        resolve?.(getResult({ code, signal }))
      }
    })
  proc.stdout?.on('data', c => stdout.push(c)).on('error', rejectWithOpts)
  proc.stderr?.on('data', c => stderr.push(c)).on('error', rejectWithOpts)
  ;(promise as any).stdin = proc.stdin
  ;(promise as any).process = proc
  return promise
}
