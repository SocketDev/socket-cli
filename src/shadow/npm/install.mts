import {
  isNpmAuditFlag,
  isNpmFundFlag,
  isNpmLoglevelFlag,
  isNpmProgressFlag,
} from '@socketsecurity/lib/agent'
import { isDebug } from '@socketsecurity/lib/debug'
import { getOwn, isObject } from '@socketsecurity/lib/objects'
import { spawn } from '@socketsecurity/lib/spawn'

import { NPM } from '../../constants/agents.mts'
import { FLAG_LOGLEVEL } from '../../constants/cli.mts'
import ENV, { processEnv } from '../../constants/env.mts'
import {
  execPath,
  instrumentWithSentryPath,
  nodeDebugFlags,
  nodeHardenFlags,
  nodeNoWarningsFlags,
  shadowNpmInjectPath,
} from '../../constants/paths.mts'
import {
  SOCKET_CLI_SHADOW_BIN,
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_IPC_HANDSHAKE,
} from '../../constants/shadow.mts'
import { getNpmBinPath } from '../../utils/npm/paths.mts'

import type { SpawnResult } from '@socketsecurity/lib/spawn'
import type { Spinner } from '@socketsecurity/lib/spinner'

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

export type ShadowNpmInstallOptions = SpawnOption & {
  agentExecPath?: string | undefined
  args?: string[] | readonly string[] | undefined
  ipc?: object | undefined
  spinner?: Spinner | undefined
}

export function shadowNpmInstall(
  options?: ShadowNpmInstallOptions | undefined,
): SpawnResult {
  const {
    agentExecPath = getNpmBinPath(),
    args = [],
    ipc,
    spinner,
    ...spawnOpts
  } = { __proto__: null, ...options } as ShadowNpmInstallOptions
  const useDebug = isDebug()
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const binArgs = rawBinArgs.filter(
    a => !isNpmAuditFlag(a) && !isNpmFundFlag(a) && !isNpmProgressFlag(a),
  )
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const progressArg = rawBinArgs.findLast(isNpmProgressFlag) !== '--no-progress'
  const isSilent = !useDebug && !binArgs.some(isNpmLoglevelFlag)
  const logLevelArgs = isSilent ? [FLAG_LOGLEVEL, 'silent'] : []
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
    execPath,
    [
      ...nodeNoWarningsFlags,
      ...nodeDebugFlags,
      ...nodeHardenFlags,
      // Memory flags commented out.
      // ...constants.nodeMemoryFlags,
      ...(ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', instrumentWithSentryPath]
        : []),
      '--require',
      shadowNpmInjectPath,
      agentExecPath,
      'install',
      // Avoid code paths for 'audit' and 'fund'.
      '--no-audit',
      '--no-fund',
      // Add '--no-progress' to fix input being swallowed by the npm spinner.
      '--no-progress',
      // Add 'FLAG_LOGLEVEL silent' if a loglevel flag is not provided and the
      // SOCKET_CLI_DEBUG environment variable is not truthy.
      ...logLevelArgs,
      ...binArgs,
      ...otherArgs,
    ],
    {
      ...spawnOpts,
      env: {
        ...process.env,
        ...processEnv,
        // @ts-expect-error - getOwn may return undefined, but spread handles it
        ...getOwn(spawnOpts, 'env'),
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
