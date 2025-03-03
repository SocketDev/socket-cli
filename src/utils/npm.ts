import process from 'node:process'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import { isObject } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants'
import { getNpmBinPath } from '../shadow/npm-paths'

import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { SOCKET_IPC_HANDSHAKE, abortSignal } = constants

const auditFlags = new Set(['--audit', '--no-audit'])

const fundFlags = new Set(['--fund', '--no-fund'])

// https://docs.npmjs.com/cli/v11/using-npm/logging#aliases
const logFlags = new Set([
  '--loglevel',
  '-d',
  '--dd',
  '--ddd',
  '-q',
  '--quiet',
  '-s',
  '--silent'
])

const progressFlags = new Set(['--progress', '--no-progress'])

export function isAuditFlag(cmdArg: string) {
  return auditFlags.has(cmdArg)
}

export function isFundFlag(cmdArg: string) {
  return fundFlags.has(cmdArg)
}

export function isLoglevelFlag(cmdArg: string) {
  // https://docs.npmjs.com/cli/v11/using-npm/logging#setting-log-levels
  return cmdArg.startsWith('--loglevel=') || logFlags.has(cmdArg)
}

export function isProgressFlag(cmdArg: string) {
  return progressFlags.has(cmdArg)
}

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

type SafeNpmInstallOptions = SpawnOption & {
  args?: string[] | undefined
  ipc?: object | undefined
  spinner?: Spinner | undefined
}

export function safeNpmInstall(options?: SafeNpmInstallOptions) {
  const {
    args = [],
    ipc,
    spinner,
    ...spawnOptions
  } = <SafeNpmInstallOptions>{ __proto__: null, ...options }
  const terminatorPos = args.indexOf('--')
  const npmArgs = (
    terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  ).filter(a => !isAuditFlag(a) && !isFundFlag(a) && !isProgressFlag(a))
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const useIpc = isObject(ipc)
  const useDebug = isDebug()
  const isSilent = !useDebug && !npmArgs.some(isLoglevelFlag)
  const isSpinning = spinner?.isSpinning ?? false
  if (!isSilent) {
    spinner?.stop()
  }
  let spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      '--require',
      // Lazily access constants.npmInjectionPath.
      constants.npmInjectionPath,
      getNpmBinPath(),
      'install',
      // Even though the '--silent' flag is passed npm will still run through
      // code paths for 'audit' and 'fund' unless '--no-audit' and '--no-fund'
      // flags are passed.
      '--no-audit',
      '--no-fund',
      // Add `--no-progress` and `--silent` flags to fix input being swallowed
      // by the spinner when running the command with recent versions of npm.
      '--no-progress',
      // Add the '--silent' flag if a loglevel flag is not provided and the
      // SOCKET_CLI_DEBUG environment variable is not truthy.
      ...(isSilent ? ['--silent'] : []),
      ...npmArgs,
      ...otherArgs
    ],
    {
      signal: abortSignal,
      // Set stdio to include 'ipc'.
      // See https://github.com/nodejs/node/blob/v23.6.0/lib/child_process.js#L161-L166
      // and https://github.com/nodejs/node/blob/v23.6.0/lib/internal/child_process.js#L238.
      stdio: isSilent
        ? // 'ignore'
          useIpc
          ? ['ignore', 'ignore', 'ignore', 'ipc']
          : 'ignore'
        : // 'inherit'
          useIpc
          ? [0, 1, 2, 'ipc']
          : 'inherit',
      ...spawnOptions,
      env: {
        ...process.env,
        ...spawnOptions.env
      }
    }
  )
  if (useIpc) {
    spawnPromise.process.send({ [SOCKET_IPC_HANDSHAKE]: ipc })
  }
  if (!isSilent && isSpinning) {
    const oldSpawnPromise = spawnPromise
    spawnPromise = <typeof oldSpawnPromise>spawnPromise.finally(() => {
      spinner?.start()
    })
    spawnPromise.process = oldSpawnPromise.process
    ;(spawnPromise as any).stdin = (spawnPromise as any).stdin
  }
  return spawnPromise
}
