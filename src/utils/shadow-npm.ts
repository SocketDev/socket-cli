import path from 'node:path'

import spawn from '@npmcli/promise-spawn'

import constants from '../constants'

const { abortSignal } = constants

type ShadowNpmInstallOptions = Exclude<
  Parameters<typeof spawn>[2],
  undefined
> & {
  flags?: string[]
}

export async function shadowNpmInstall(
  opts?: ShadowNpmInstallOptions
): Promise<Awaited<ReturnType<typeof spawn>>> {
  const { flags = [], ...spawnOptions } = { __proto__: null, ...opts }
  // Lazily access constants.ENV.
  const { SOCKET_CLI_DEBUG } = constants.ENV
  return await spawn(
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
  )
}
