import { isDebug } from '@socketsecurity/registry/lib/debug'
import {
  isNpmLoglevelFlag,
  isNpmNodeOptionsFlag,
  isNpmProgressFlag,
} from '@socketsecurity/registry/lib/npm'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { installLinks } from './link.mts'
import constants from '../../constants.mts'
import { cmdFlagsToString } from '../../utils/cmd.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

const { SOCKET_CLI_SAFE_BIN, SOCKET_CLI_SAFE_PROGRESS, SOCKET_IPC_HANDSHAKE } =
  constants

export default async function shadowBin(
  binName: 'npm' | 'npx',
  args = process.argv.slice(2),
) {
  process.exitCode = 1
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const binArgs = rawBinArgs.filter(
    a => !isNpmProgressFlag(a) && !isNpmNodeOptionsFlag(a),
  )
  const nodeOptionsArg = rawBinArgs.findLast(isNpmNodeOptionsFlag)
  const progressArg = rawBinArgs.findLast(isNpmProgressFlag) !== '--no-progress'
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const permArgs =
    binName === 'npm' &&
    // Lazily access constants.SUPPORTS_NODE_PERMISSION_FLAG.
    constants.SUPPORTS_NODE_PERMISSION_FLAG
      ? await (async () => {
          const cwd = process.cwd()
          const stdioPipeOptions: SpawnOptions = { cwd }
          const globalPrefix = (
            await spawn('npm', ['prefix', '-g'], stdioPipeOptions)
          ).stdout
          const npmCachePath = (
            await spawn('npm', ['config', 'get', 'cache'], stdioPipeOptions)
          ).stdout
          return [
            '--permission',
            '--allow-child-process',
            // '--allow-addons',
            // '--allow-wasi',
            // Allow all reads because npm walks up directories looking for config
            // and package.json files.
            '--allow-fs-read=*',
            `--allow-fs-write=${cwd}/*`,
            `--allow-fs-write=${globalPrefix}/*`,
            `--allow-fs-write=${npmCachePath}/*`,
          ]
        })()
      : []
  const useDebug = isDebug('stdio')
  const useNodeOptions = nodeOptionsArg || permArgs.length
  const isSilent = !useDebug && !binArgs.some(isNpmLoglevelFlag)
  // The default value of loglevel is "notice". We default to "error" which is
  // two levels quieter.
  const logLevelArgs = isSilent ? ['--loglevel', 'error'] : []
  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeHardenFlags.
      ...constants.nodeHardenFlags,
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
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
      // Lazily access constants.shadowBinPath.
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
      env: {
        ...process.env,
        // Lazily access constants.processEnv.
        ...constants.processEnv,
      },
      // 'inherit' + 'ipc'
      stdio: [0, 1, 2, 'ipc'],
    },
  )
  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      process.kill(process.pid, signalName)
    } else if (code !== null) {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })
  spawnPromise.process.send({
    [SOCKET_IPC_HANDSHAKE]: {
      [SOCKET_CLI_SAFE_BIN]: binName,
      [SOCKET_CLI_SAFE_PROGRESS]: progressArg,
    },
  })
  await spawnPromise
}
