import { isDebug } from '@socketsecurity/registry/lib/debug'
import {
  isNpmLoglevelFlag,
  isNpmNodeOptionsFlag,
  isNpmProgressFlag,
} from '@socketsecurity/registry/lib/npm'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { installLinks } from './link.mts'
import constants from '../../constants.mts'
import { cmdFlagsToString } from '../../utils/cmd.mts'
import { getPublicApiToken } from '../../utils/sdk.mts'

import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'

export type ShadowBinOptions = SpawnOptions & {
  apiToken?: string | undefined
}

export default async function shadowBin(
  binName: 'npm' | 'npx',
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<SpawnResult<string, SpawnExtra | undefined>> {
  process.exitCode = 1
  const {
    apiToken = getPublicApiToken(),
    env: spawnEnv,
    ...spawnOpts
  } = { __proto__: null, ...options } as ShadowBinOptions
  const isShadowNpm = binName === 'npm'
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const binArgs = rawBinArgs.filter(
    a => !isNpmProgressFlag(a) && !isNpmNodeOptionsFlag(a),
  )
  const nodeOptionsArg = rawBinArgs.findLast(isNpmNodeOptionsFlag)
  const progressArg = rawBinArgs.findLast(isNpmProgressFlag) !== '--no-progress'
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const permArgs =
    isShadowNpm && constants.SUPPORTS_NODE_PERMISSION_FLAG
      ? [
          '--permission',
          '--allow-child-process',
          // '--allow-addons',
          // '--allow-wasi',
          // Allow all reads because npm walks up directories looking for config
          // and package.json files.
          '--allow-fs-read=*',
          `--allow-fs-write=${process.cwd()}/*`,
          `--allow-fs-write=${constants.npmGlobalPrefix}/*`,
          `--allow-fs-write=${constants.npmCachePath}/*`,
        ]
      : []
  const useDebug = isDebug('stdio')
  const useNodeOptions = nodeOptionsArg || permArgs.length
  const isSilent = !useDebug && !binArgs.some(isNpmLoglevelFlag)
  // The default value of loglevel is "notice". We default to "error" which is
  // two levels quieter.
  const logLevelArgs = isSilent ? ['--loglevel', 'error'] : []

  let stdio = getOwn(spawnOpts, 'stdio')
  if (typeof stdio === 'string') {
    stdio = [stdio, stdio, stdio, 'ipc']
  } else if (Array.isArray(stdio)) {
    if (!stdio.includes('ipc')) {
      stdio = stdio.concat('ipc')
    }
  } else {
    stdio = ['pipe', 'pipe', 'pipe', 'ipc']
  }

  const spawnPromise = spawn(
    constants.execPath,
    [
      ...constants.nodeNoWarningsFlags,
      ...constants.nodeHardenFlags,
      ...constants.nodeMemoryFlags,
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', constants.instrumentWithSentryPath]
        : []),
      '--require',
      constants.shadowNpmInjectPath,
      await installLinks(constants.shadowBinPath, binName),
      ...(useDebug ? ['--trace-uncaught', '--trace-warnings'] : []),
      ...(useNodeOptions
        ? [
            `--node-options='${nodeOptionsArg ? nodeOptionsArg.slice(15) : ''}${cmdFlagsToString(permArgs)}'`,
          ]
        : []),
      // Add '--no-progress' to fix input being swallowed by the npm spinner.
      '--no-progress',
      // Add '--loglevel=error' if a loglevel flag is not provided and the
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
        ...spawnEnv,
      },
      stdio,
    },
    extra,
  )

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code) {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })

  spawnPromise.process.send({
    [constants.SOCKET_IPC_HANDSHAKE]: {
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]: apiToken,
      [constants.SOCKET_CLI_SHADOW_BIN]: binName,
      [constants.SOCKET_CLI_SHADOW_PROGRESS]: progressArg,
    },
  })

  // eslint-disable-next-line @typescript-eslint/return-await
  return spawnPromise
}
