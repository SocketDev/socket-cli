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

import { InputError } from '../../../utils/errors.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

export function getBazelEnvironment(
  overrides: NodeJS.ProcessEnv = {},
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const [key, value] of Object.entries(overrides)) {
    const existing =
      platform === 'win32'
        ? Object.keys(env).find(
            name => name.toLowerCase() === key.toLowerCase(),
          )
        : undefined
    env[existing ?? key] = value
  }
  return env
}

export function getBazelEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const key =
    process.platform === 'win32'
      ? Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())
      : name
  return key ? env[key] : undefined
}

export async function findBazelExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string | undefined> {
  const searchPath = (getBazelEnvironmentValue(env, 'PATH') ?? '')
    .split(path.delimiter)
    .map(entry => path.resolve(cwd, entry))
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
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
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

function escapeBatchArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new InputError(
      'Bazel batch launchers cannot accept arguments containing newlines or NUL characters. Use a native .exe launcher.',
    )
  }
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
  // Batch forwarding parses arguments twice, so protect each shell metacharacter twice.
  return quoted
    .replace(/[ !%^&()<>|"]/g, '^$&')
    .replace(/[ !%^&()<>|"]/g, '^$&')
}

export function buildBazelProcessInvocation(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (isNodeScript(bin)) {
    return { command: process.execPath, args: [bin, ...args] }
  }
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin)) {
    const command = bin.replace(/[ !%^&()<>|"]/g, '^$&')
    const script = [command, ...args.map(escapeBatchArgument)].join(' ')
    return {
      command: getBazelEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `"${script}"`],
      windowsVerbatimArguments: true,
    }
  }
  return { command: bin, args }
}

export function spawnBazel(bin: string, args: string[], options: SpawnOptions) {
  const env = getBazelEnvironment(options.env)
  const invocation = buildBazelProcessInvocation(bin, args, env)
  return spawn(invocation.command, invocation.args, {
    ...options,
    ...('windowsVerbatimArguments' in invocation
      ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments }
      : {}),
    env,
    shell: false,
  })
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
