/**
 * Local copy of @socketsecurity/registry/lib/spawn from @socketsecurity/registry 1.1.17.
 * Copyright (c) Socket Inc. and contributors. Licensed under the MIT license.
 * Source: node_modules/@socketsecurity/registry/lib/spawn.js
 *
 * Kept local so the CLI can bundle its spawn runtime without reaching into the
 * registry package's private source helpers.
 */
import Stream from 'node:stream'

import crossSpawn from 'cross-spawn'

import { spawnSync } from './spawn-sync.mts'
import constants from '../constants.mts'

import type { Remap } from './objects.mts'
import type { Spinner } from './spinner.mts'
import type {
  SpawnOptions as BaseSpawnOptions,
  ChildProcess,
  IOType,
  StdioOptions,
} from 'node:child_process'

export type SpawnError = {
  args: string[] | readonly string[]
  cmd: string
  code: number
  name: 'Error'
  message: 'command failed'
  signal: AbortSignal | null
  stack: string
  stderr: string | Buffer
  stdout: string | Buffer
}
export type SpawnErrorWithOutputString = Omit<
  SpawnError,
  'stderr' | 'stdout'
> & {
  stdout: string
  stderr: string
}
export type SpawnErrorWithOutputBuffer = Omit<
  SpawnError,
  'stderr' | 'stdout'
> & {
  stdout: Buffer
  stderr: Buffer
}
export type SpawnExtra = Record<any, any>
export type SpawnStdioResult<Output = string, Extra = undefined> = {
  cmd: string
  args: string[] | readonly string[]
  code: number
  signal: AbortSignal | null
  stdout: Output
  stderr: Output
} & Extra
export type SpawnResult<Output = string, Extra = undefined> = Promise<
  SpawnStdioResult<Output, Extra>
> & { process: ChildProcess; stdin: Stream.Writable | null }
export type SpawnOptions = Remap<
  BaseSpawnOptions & {
    spinner?: Spinner | undefined
    stdioString?: boolean | undefined
    stripAnsi?: boolean | undefined
  }
>
export type SpawnSyncOptions = Omit<SpawnOptions, 'spinner'> & {
  encoding?: BufferEncoding | 'buffer' | null | undefined
}
export interface SpawnSyncOptionsWithStringEncoding extends SpawnSyncOptions {
  encoding: BufferEncoding
}
export interface SpawnSyncOptionsWithBufferEncoding extends SpawnSyncOptions {
  encoding?: 'buffer' | null | undefined
}
export interface SpawnSyncReturns<T> {
  pid: number
  output: Array<T | null>
  stdout: T
  stderr: T
  status: number | null
  signal: NodeJS.Signals | null
  error?: Error | undefined
}
export type StdioType = IOType | 'ipc' | Array<IOType | 'ipc'>
const ansiRegExp =
  // eslint-disable-next-line no-control-regex -- The expression removes ANSI control codes.
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C)|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g

function isSpawnError(value: unknown): value is SpawnError {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'code') &&
    typeof (value as SpawnError).code === 'number' &&
    Object.prototype.hasOwnProperty.call(value, 'cmd') &&
    typeof (value as SpawnError).cmd === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'args') &&
    Array.isArray((value as SpawnError).args)
  )
}

function isStdioType(
  stdio: StdioOptions | undefined,
  type: StdioType,
): boolean {
  return (
    stdio === type ||
    ((stdio === null || stdio === undefined) && type === 'pipe') ||
    (Array.isArray(stdio) &&
      stdio.length > 2 &&
      stdio[0] === type &&
      stdio[1] === type &&
      stdio[2] === type)
  )
}

function stripAnsiFromSpawnResult<
  T extends { stdout?: string | Buffer; stderr?: string | Buffer },
>(result: T): T {
  const { stderr, stdout } = result
  if (typeof stdout === 'string') {
    result.stdout = stdout.replace(ansiRegExp, '')
  }
  if (typeof stderr === 'string') {
    result.stderr = stderr.replace(ansiRegExp, '')
  }
  return result
}

function spawn<O extends SpawnOptions = SpawnOptions>(
  cmd: string,
  args: string[] | readonly string[],
  options?: O,
  extra?: SpawnExtra,
): SpawnResult<
  O extends { stdioString: false } ? Buffer : string,
  typeof extra
> {
  const {
    spinner: activeSpinner = constants.spinner,
    stripAnsi: shouldStripAnsi = true,
    ...spawnOptions
  } = { __proto__: null, ...options }
  const { env, stdio, stdioString = true } = spawnOptions
  const wasSpinning = !!activeSpinner?.isSpinning
  const shouldStopSpinner =
    wasSpinning && !isStdioType(stdio, 'ignore') && !isStdioType(stdio, 'pipe')
  if (shouldStopSpinner) {
    activeSpinner.stop()
  }
  const childEnv = Object.assign(
    Object.create(null) as NodeJS.ProcessEnv,
    process.env,
    env,
  )
  const normalizedOptions = {
    signal: abortSignal,
    ...spawnOptions,
    // cross-spawn launches Windows command shims without a shell. Do not pass
    // through shell=true because command and arguments can come from PATH or
    // package-manager environment values.
    shell: false,
    env: childEnv,
  } as BaseSpawnOptions
  const child = crossSpawn(cmd, [...args], normalizedOptions)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const collect = (stream: NodeJS.ReadableStream | null, chunks: Buffer[]) => {
    stream?.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
  }
  collect(child.stdout, stdout)
  collect(child.stderr, stderr)
  let resolvePromise!: (value: any) => void
  let rejectPromise!: (reason: unknown) => void
  let spawnPromise: any = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  spawnPromise.process = child
  spawnPromise.stdin = child.stdin
  const getOutput = (chunks: Buffer[], fd: 1 | 2) => {
    const stdioValue = Array.isArray(spawnOptions.stdio)
      ? spawnOptions.stdio[fd]
      : spawnOptions.stdio
    if (
      stdioValue !== undefined &&
      stdioValue !== 'pipe' &&
      stdioValue !== null
    ) {
      return null
    }
    const output = Buffer.concat(chunks)
    return stdioString ? output.toString().trim() : output
  }
  const getResult = (code: number | null, signal: NodeJS.Signals | null) => ({
    cmd,
    args,
    code,
    signal,
    stdout: getOutput(stdout, 1),
    stderr: getOutput(stderr, 2),
    ...extra,
  })
  const closeError = new Error('command failed')
  child.on('error', error => {
    Object.assign(error, {
      cmd,
      args,
      signal: normalizedOptions.signal ?? null,
      stdout: getOutput(stdout, 1),
      stderr: getOutput(stderr, 2),
      ...extra,
    })
    rejectPromise(error)
  })
  child.on('close', (code, signal) => {
    if (code || signal) {
      rejectPromise(Object.assign(closeError, getResult(code, signal)))
    } else {
      resolvePromise(getResult(code, signal))
    }
  })
  const oldSpawnPromise = spawnPromise
  if (shouldStripAnsi && stdioString) {
    spawnPromise = spawnPromise
      .then(stripAnsiFromSpawnResult)
      .catch((error: unknown) => {
        throw stripAnsiFromSpawnResult(
          error as { stdout?: string | Buffer; stderr?: string | Buffer },
        )
      })
  }
  if (shouldStopSpinner) {
    spawnPromise = spawnPromise.finally(() => activeSpinner.start())
  }
  for (const key of Object.keys(oldSpawnPromise)) {
    ;(spawnPromise as any)[key] = (oldSpawnPromise as any)[key]
  }
  return spawnPromise as SpawnResult<
    O extends { stdioString: false } ? Buffer : string,
    typeof extra
  >
}

const abortController = new AbortController()
const abortSignal = abortController.signal
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  const handler = () => {
    abortController.abort()
    process.removeListener(signal, handler)
    process.kill(process.pid, signal)
  }
  try {
    process.once(signal, handler)
  } catch {
    // Some signals are unavailable on Windows.
  }
}
process.once('exit', () => abortController.abort())

export { isSpawnError, isStdioType, spawn, spawnSync }
