import path from 'node:path'
import process from 'node:process'

import { fork } from './promise-fork'
import constants from '../constants'

import type { ForkOptions, ForkResult } from './promise-fork'

const { abortSignal } = constants

type ShadowNpmInstallOptions = ForkOptions & {
  flags?: string[]
}

export function shadowNpmInstall<O extends ShadowNpmInstallOptions>(
  opts?: ShadowNpmInstallOptions
) {
  const { flags = [], ...spawnOptions } = { __proto__: null, ...opts }
  // Lazily access constants.ENV.
  const { SOCKET_CLI_DEBUG } = constants.ENV
  return fork(
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
      // Lazily access constants.ENV.
      stdio: SOCKET_CLI_DEBUG ? 'inherit' : 'ignore',
      ...spawnOptions,
      env: {
        ...process.env,
        ...spawnOptions.env
      }
    }
  ) as ForkResult<O extends { stdioString: false } ? Buffer : string, undefined>
}
