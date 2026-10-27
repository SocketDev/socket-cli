import { execFile } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'

import which from 'which'

import { resolveBinPathSync } from '@socketsecurity/registry/lib/bin'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../../constants.mts'
import { InputError, isErrnoException } from '../../../utils/errors.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'
import type { ChildProcess } from 'node:child_process'

function findEnvironmentKey(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') {
    return name
  }
  const lower = name.toLowerCase()
  return Object.keys(env).find(key => key.toLowerCase() === lower) ?? name
}

export function getBazelEnvironment(
  overrides: NodeJS.ProcessEnv = {},
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const [key, value] of Object.entries(overrides)) {
    env[findEnvironmentKey(env, key, platform)] = value
  }
  return env
}

export function getBazelEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  return env[findEnvironmentKey(env, name)]
}

export function prependBazelPath(
  env: NodeJS.ProcessEnv,
  dir: string,
): NodeJS.ProcessEnv {
  const key = findEnvironmentKey(env, 'PATH')
  return { ...env, [key]: `${dir}${path.delimiter}${env[key] ?? ''}` }
}

export async function findBazelExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string | undefined> {
  const searchPath = (getBazelEnvironmentValue(env, 'PATH') ?? '')
    .split(path.delimiter)
    .map(entry => path.resolve(cwd, entry.replace(/^"(.*)"$/, '$1')))
    .join(path.delimiter)
  const found = await which(name, {
    nothrow: true,
    path: searchPath,
    pathExt: getBazelEnvironmentValue(env, 'PATHEXT'),
  })
  return found ? resolveBazelExecutable(found) : undefined
}

export function resolveBazelExecutable(file: string): string {
  const resolved = realpathSync(file)
  const extension = path.extname(resolved).toLowerCase()
  if (
    process.platform !== 'win32' ||
    !['', '.cmd', '.ps1'].includes(extension)
  ) {
    return resolved
  }
  try {
    return resolveBinPathSync(resolved)
  } catch (e) {
    if (extension === '.ps1') {
      throw new InputError(
        'This PowerShell Bazel launcher could not be resolved to a Node entry point. Pass a native .exe, a .cmd or .bat wrapper, or a JavaScript entry point with --bazel.',
      )
    }
    if (isErrnoException(e) && e.code === 'ENOENT') {
      return resolved
    }
    throw e
  }
}

function isNodeScript(bin: string): boolean {
  if (/\.[cm]?js$/i.test(bin)) {
    return true
  }
  if (path.extname(bin) || process.platform !== 'win32' || !existsSync(bin)) {
    return false
  }
  const fd = openSync(bin, 'r')
  try {
    const header = Buffer.alloc(256)
    const length = readSync(fd, header)
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(header.toString('utf8', 0, length))
  } finally {
    closeSync(fd)
  }
}

const BATCH_METACHARACTERS = /[ !%^&()<>|"]/g

function escapeBatchMetacharacters(value: string): string {
  return value.replace(BATCH_METACHARACTERS, '^$&')
}

function escapeBatchArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new InputError(
      'Bazel batch launchers cannot accept arguments containing newlines or NUL characters. Use a native .exe launcher.',
    )
  }
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
  // Batch forwarding parses arguments twice, so protect each shell metacharacter twice.
  return escapeBatchMetacharacters(escapeBatchMetacharacters(quoted))
}

function buildBazelProcessInvocation(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (isNodeScript(bin)) {
    return {
      command: process.execPath,
      args: [bin, ...args],
      windowsVerbatimArguments: false,
    }
  }
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin)) {
    const script = [
      escapeBatchMetacharacters(bin),
      ...args.map(escapeBatchArgument),
    ].join(' ')
    return {
      command: getBazelEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `"${script}"`],
      windowsVerbatimArguments: true,
    }
  }
  return { command: bin, args, windowsVerbatimArguments: false }
}

export class BazelTimeoutError extends Error {
  readonly stdout: string
  readonly stderr: string

  constructor(timeout: number, cause: unknown) {
    super(`Bazel did not finish within ${timeout}ms`, { cause })
    this.stdout = readOutput(cause, 'stdout')
    this.stderr = readOutput(cause, 'stderr')
  }
}

function readOutput(error: unknown, key: 'stdout' | 'stderr'): string {
  if (error && typeof error === 'object' && key in error) {
    const value: unknown = Reflect.get(error, key)
    return typeof value === 'string' ? value : ''
  }
  return ''
}

// Launchers can leave Bazel holding the output pipes after the launcher is killed.
const PIPE_RELEASE_GRACE_MS = 5_000

async function killProcessTree(child: ChildProcess): Promise<void> {
  const { pid } = child
  if (pid === undefined) {
    return
  }
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve())
    })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch (e) {
    if (!isErrnoException(e) || e.code !== 'ESRCH') {
      throw e
    }
  }
}

export async function spawnBazel(
  bin: string,
  args: string[],
  {
    signal = constants.abortSignal,
    timeout,
    ...options
  }: Omit<SpawnOptions, 'stdioString'>,
) {
  const env = getBazelEnvironment(options.env)
  const invocation = buildBazelProcessInvocation(bin, args, env)
  const controller = new AbortController()
  const pending = spawn(invocation.command, invocation.args, {
    ...options,
    // A process group of its own lets a timeout or abort reach everything the launcher started.
    detached: process.platform !== 'win32',
    env,
    shell: false,
    signal: controller.signal,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  })
  let timedOut = false
  let releaseTimer: NodeJS.Timeout | undefined
  const stop = () => {
    releaseTimer ??= setTimeout(() => {
      pending.process.stdout?.destroy()
      pending.process.stderr?.destroy()
    }, PIPE_RELEASE_GRACE_MS)
    return killProcessTree(pending.process)
  }
  const onAbort = () => {
    // taskkill finds descendants through the launcher, so the launcher must outlive the tree kill.
    void stop().finally(() => controller.abort(signal.reason))
  }
  if (signal.aborted) {
    onAbort()
  } else {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = timeout
    ? setTimeout(() => {
        timedOut = true
        void stop()
      }, timeout)
    : undefined
  let result: Awaited<typeof pending>
  try {
    result = await pending
  } catch (e) {
    if (timedOut && timeout) {
      throw new BazelTimeoutError(timeout, e)
    }
    throw e
  } finally {
    clearTimeout(timer)
    clearTimeout(releaseTimer)
    signal.removeEventListener('abort', onAbort)
  }
  // Output is incomplete when the pipes were released after a timeout.
  if (timedOut && timeout) {
    throw new BazelTimeoutError(timeout, result)
  }
  return result
}

export function buildBazelStartupFlags(opts: {
  bazelRc?: string
  bazelOutputBase?: string
  outputUserRoot?: string
}): string[] {
  const startup: string[] = []
  if (opts.bazelRc) {
    startup.push(`--bazelrc=${opts.bazelRc}`)
  }
  if (opts.outputUserRoot) {
    startup.push(`--output_user_root=${opts.outputUserRoot}`)
  }
  if (opts.bazelOutputBase) {
    startup.push(`--output_base=${opts.bazelOutputBase}`)
  }
  return startup
}
