import path from 'node:path'
import process from 'node:process'

import spawn from '@npmcli/promise-spawn'

import { isObject } from '@socketsecurity/registry/lib/objects'

import { isDebug } from './debug'
import constants from '../constants'
import { getNpmBinPath } from '../shadow/npm-paths'

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
  args?: string[]
  ipc?: object
}

export function safeNpmInstall(opts?: SafeNpmInstallOptions) {
  const { args = [], ipc, ...spawnOptions } = { __proto__: null, ...opts }
  const terminatorPos = args.indexOf('--')
  const npmArgs = (
    terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  ).filter(a => !isAuditFlag(a) && !isFundFlag(a) && !isProgressFlag(a))
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const useIpc = isObject(ipc)
  const useDebug = isDebug()
  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      '--require',
      // Lazily access constants.distPath.
      path.join(constants.distPath, 'npm-injection.js'),
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
      ...(useDebug || npmArgs.some(isLoglevelFlag) ? [] : ['--silent']),
      ...npmArgs,
      ...otherArgs
    ],
    {
      signal: abortSignal,
      // Set stdio to include 'ipc'.
      // See https://github.com/nodejs/node/blob/v23.6.0/lib/child_process.js#L161-L166
      // and https://github.com/nodejs/node/blob/v23.6.0/lib/internal/child_process.js#L238.
      stdio: useDebug
        ? // 'inherit'
          useIpc
          ? [0, 1, 2, 'ipc']
          : 'inherit'
        : // 'ignore'
          useIpc
          ? ['ignore', 'ignore', 'ignore', 'ipc']
          : 'ignore',
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
  return spawnPromise
}
