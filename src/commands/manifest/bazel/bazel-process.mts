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

import { InputError, isErrnoException } from '../../../utils/errors.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

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

export function spawnBazel(bin: string, args: string[], options: SpawnOptions) {
  const env = getBazelEnvironment(options.env)
  const invocation = buildBazelProcessInvocation(bin, args, env)
  return spawn(invocation.command, invocation.args, {
    ...options,
    env,
    shell: false,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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
