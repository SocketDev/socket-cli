import path from 'node:path'
import process from 'node:process'

import spawn from '@npmcli/promise-spawn'

import { isObject } from '@socketsecurity/registry/lib/objects'

import constants from '../constants'

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

const { abortSignal } = constants

type ShadowNpmInstallOptions = SpawnOption & {
  flags?: string[]
  ipc?: object
}

export function shadowNpmInstall(opts?: ShadowNpmInstallOptions) {
  const { flags = [], ipc, ...spawnOptions } = { __proto__: null, ...opts }
  const useIpc = isObject(ipc)
  // Lazily access constants.ENV.
  const { SOCKET_CLI_DEBUG } = constants.ENV
  const promise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.rootBinPath.
      path.join(constants.rootBinPath, 'npm-cli.js'),
      'install',
      // Even though the 'silent' flag is passed npm will still run through code
      // paths for 'audit' and 'fund' unless '--no-audit' and '--no-fund' flags
      // are passed.
      ...(SOCKET_CLI_DEBUG
        ? ['--no-audit', '--no-fund']
        : ['silent', '--no-audit', '--no-fund']),
      ...flags
    ],
    {
      signal: abortSignal,
      // Set stdio to include 'ipc'.
      // See https://github.com/nodejs/node/blob/v23.6.0/lib/child_process.js#L161-L166
      // and https://github.com/nodejs/node/blob/v23.6.0/lib/internal/child_process.js#L238.
      stdio: SOCKET_CLI_DEBUG
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
    promise.process.send(ipc)
  }
  return promise
}
