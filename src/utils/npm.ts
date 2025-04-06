import process from 'node:process'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import {
  isAuditFlag,
  isFundFlag,
  isLoglevelFlag,
  isProgressFlag
} from '@socketsecurity/registry/lib/npm'
import { isObject } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants'
import { getNpmBinPath } from '../shadow/npm/paths'

import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const {
  NPM,
  SOCKET_CLI_SAFE_BIN,
  SOCKET_CLI_SAFE_PROGRESS,
  SOCKET_IPC_HANDSHAKE
} = constants

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

type SafeNpmInstallOptions = SpawnOption & {
  agentExecPath?: string | undefined
  args?: string[] | readonly string[] | undefined
  ipc?: object | undefined
  spinner?: Spinner | undefined
}

export function safeNpmInstall(options?: SafeNpmInstallOptions) {
  const {
    agentExecPath = getNpmBinPath(),
    args = [],
    ipc,
    spinner,
    ...spawnOptions
  } = { __proto__: null, ...options } as SafeNpmInstallOptions
  let stdio = spawnOptions.stdio
  const useIpc = isObject(ipc)
  // Include 'ipc' in the spawnOptions.stdio when an options.ipc object is provided.
  // See https://github.com/nodejs/node/blob/v23.6.0/lib/child_process.js#L161-L166
  // and https://github.com/nodejs/node/blob/v23.6.0/lib/internal/child_process.js#L238.
  if (typeof stdio === 'string') {
    stdio = useIpc ? [stdio, stdio, stdio, 'ipc'] : [stdio, stdio, stdio]
  } else if (useIpc && Array.isArray(stdio) && !stdio.includes('ipc')) {
    stdio = stdio.concat('ipc')
  }
  const useDebug = isDebug()
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const progressArg = rawBinArgs.findLast(isProgressFlag) !== '--no-progress'
  const binArgs = rawBinArgs.filter(
    a => !isAuditFlag(a) && !isFundFlag(a) && !isProgressFlag(a)
  )
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const isSilent = !useDebug && !binArgs.some(isLoglevelFlag)
  const logLevelArgs = isSilent ? ['--loglevel', 'silent'] : []
  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeHardenFlags.
      ...constants.nodeHardenFlags,
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      // Lazily access process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'].
      ...(process.env['INLINED_SOCKET_CLI_SENTRY_BUILD']
        ? [
            '--require',
            // Lazily access constants.distInstrumentWithSentryPath.
            constants.distInstrumentWithSentryPath
          ]
        : []),
      '--require',
      // Lazily access constants.distShadowNpmInjectPath.
      constants.distShadowNpmInjectPath,
      agentExecPath,
      'install',
      // Avoid code paths for 'audit' and 'fund'.
      '--no-audit',
      '--no-fund',
      // Add '--no-progress' to fix input being swallowed by the npm spinner.
      '--no-progress',
      // Add '--loglevel=silent' if a loglevel flag is not provided and the
      // SOCKET_CLI_DEBUG environment variable is not truthy.
      ...logLevelArgs,
      ...binArgs,
      ...otherArgs
    ],
    {
      spinner,
      ...spawnOptions,
      stdio,
      env: {
        ...process.env,
        ...spawnOptions.env
      }
    }
  )
  if (useIpc) {
    spawnPromise.process.send({
      [SOCKET_IPC_HANDSHAKE]: {
        [SOCKET_CLI_SAFE_BIN]: NPM,
        [SOCKET_CLI_SAFE_PROGRESS]: progressArg,
        ...ipc
      }
    })
  }
  return spawnPromise
}
