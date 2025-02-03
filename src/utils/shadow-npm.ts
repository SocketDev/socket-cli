import path from 'node:path'
import process from 'node:process'

import spawn from '@npmcli/promise-spawn'

import { isObject } from '@socketsecurity/registry/lib/objects'

import { isDebug } from './debug'
import constants from '../constants'
import { getNpmBinPath } from '../shadow/npm-paths'

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

const { abortSignal } = constants

type ShadowNpmInstallOptions = SpawnOption & {
  flags?: string[]
  ipc?: object
}

export function shadowNpmInstall(opts?: ShadowNpmInstallOptions) {
  const { flags = [], ipc, ...spawnOptions } = { __proto__: null, ...opts }
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
      // Add `--no-progress` flags to fix input being swallowed by the spinner
      // when running the command with recent versions of npm.
      '--no-progress',
      ...(useDebug ||
      flags.some(
        f =>
          f.startsWith('--loglevel') ||
          f === '-d' ||
          f === '--dd' ||
          f === '--ddd' ||
          f === '-q' ||
          f === '--quiet' ||
          f === '-s' ||
          f === '--silent'
      )
        ? []
        : ['--silent']),
      ...flags.filter(
        f =>
          f !== '--audit' &&
          f !== '--fund' &&
          f !== '--progress' &&
          f !== '--no-audit' &&
          f !== '--no-fund' &&
          f !== '--no-progress'
      )
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
    spawnPromise.process.send(ipc)
  }
  return spawnPromise
}
