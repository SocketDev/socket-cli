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
    ...spawnOpts
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

  // Include 'ipc' in the spawnOpts.stdio when an options.ipc object is provided.
  // See https://github.com/nodejs/node/blob/v23.6.0/lib/child_process.js#L161-L166
  // and https://github.com/nodejs/node/blob/v23.6.0/lib/internal/child_process.js#L238.
  let stdio = getOwn(spawnOpts, 'stdio')
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
    constants.execPath,
    [
      ...constants.nodeNoWarningsFlags,
      ...constants.nodeDebugFlags,
      ...constants.nodeHardenFlags,
      ...constants.nodeMemoryFlags,
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', constants.instrumentWithSentryPath]
        : []),
      '--require',
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
      ...spawnOpts,
      env: {
        ...process.env,
        ...constants.processEnv,
        ...getOwn(spawnOpts, 'env'),
      },
      spinner,
      stdio,
    },
  )

  if (useIpc) {
    spawnPromise.process.send({
      [constants.SOCKET_IPC_HANDSHAKE]: {
        [constants.SOCKET_CLI_SHADOW_BIN]: 'npm',
        [constants.SOCKET_CLI_SHADOW_PROGRESS]: progressArg,
        ...ipc,
      },
    })
  }

  return spawnPromise
}
