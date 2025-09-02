import { isDebug } from '@socketsecurity/registry/lib/debug'
import {
  isNpmAuditFlag,
  isNpmFundFlag,
  isNpmLoglevelFlag,
  isNpmProgressFlag,
  resolveBinPathSync,
} from '@socketsecurity/registry/lib/npm'
import { getOwn, isObject } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants.mts'
import { getNpmBinPath } from '../../utils/npm-paths.mts'

import type { SpawnResult } from '@socketsecurity/registry/lib/spawn'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const {
  NPM,
  SOCKET_CLI_SHADOW_BIN,
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_IPC_HANDSHAKE,
} = constants

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

export type ShadowNpmInstallOptions = SpawnOption & {
  agentExecPath?: string | undefined
  args?: string[] | readonly string[] | undefined
  ipc?: object | undefined
  spinner?: Spinner | undefined
}

export function shadowNpmInstall(
  options?: ShadowNpmInstallOptions,
): SpawnResult<string, Record<any, any> | undefined> {
  const {
    agentExecPath = getNpmBinPath(),
    args = [],
    ipc,
    spinner,
    ...spawnOptions
  } = { __proto__: null, ...options } as ShadowNpmInstallOptions
  const useDebug = isDebug('stdio')
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const binArgs = rawBinArgs.filter(
    a => !isNpmAuditFlag(a) && !isNpmFundFlag(a) && !isNpmProgressFlag(a),
  )
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const progressArg = rawBinArgs.findLast(isNpmProgressFlag) !== '--no-progress'
  const isSilent = !useDebug && !binArgs.some(isNpmLoglevelFlag)
  const logLevelArgs = isSilent ? ['--loglevel', 'silent'] : []
  const useIpc = isObject(ipc)

  // Include 'ipc' in the spawnOptions.stdio when an options.ipc object is provided.
  // See https://github.com/nodejs/node/blob/v23.6.0/lib/child_process.js#L161-L166
  // and https://github.com/nodejs/node/blob/v23.6.0/lib/internal/child_process.js#L238.
  let stdio = getOwn(spawnOptions, 'stdio')
  if (typeof stdio === 'string') {
    stdio = useIpc ? [stdio, stdio, stdio, 'ipc'] : [stdio, stdio, stdio]
  } else if (Array.isArray(stdio)) {
    if (useIpc && !stdio.includes('ipc')) {
      stdio = stdio.concat('ipc')
    }
  } else {
    stdio = useIpc ? ['pipe', 'pipe', 'pipe', 'ipc'] : 'pipe'
  }

  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      // Lazily access constants.nodeHardenFlags.
      ...constants.nodeHardenFlags,
      // Lazily access constants.nodeMemoryFlags.
      ...constants.nodeMemoryFlags,
      // Lazily access constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD.
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? [
            '--require',
            // Lazily access constants.instrumentWithSentryPath.
            constants.instrumentWithSentryPath,
          ]
        : []),
      '--require',
      // Lazily access constants.shadowNpmInjectPath.
      constants.shadowNpmInjectPath,
      resolveBinPathSync(agentExecPath),
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
      ...otherArgs,
    ],
    {
      ...spawnOptions,
      env: {
        ...process.env,
        // Lazily access constants.processEnv.
        ...constants.processEnv,
        ...getOwn(spawnOptions, 'env'),
      },
      spinner,
      stdio,
    },
  )

  if (useIpc) {
    spawnPromise.process.send({
      [SOCKET_IPC_HANDSHAKE]: {
        [SOCKET_CLI_SHADOW_BIN]: NPM,
        [SOCKET_CLI_SHADOW_PROGRESS]: progressArg,
        ...ipc,
      },
    })
  }

  return spawnPromise
}
