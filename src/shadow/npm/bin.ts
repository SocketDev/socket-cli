import { isDebug } from '@socketsecurity/registry/lib/debug'
import {
  isLoglevelFlag,
  isProgressFlag
} from '@socketsecurity/registry/lib/npm'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { installLinks } from './link'
import constants from '../../constants'

const { SOCKET_CLI_SAFE_BIN, SOCKET_CLI_SAFE_PROGRESS, SOCKET_IPC_HANDSHAKE } =
  constants

export default async function shadowBin(
  binName: 'npm' | 'npx',
  args = process.argv.slice(2)
) {
  process.exitCode = 1
  const useDebug = isDebug()
  const terminatorPos = args.indexOf('--')
  const rawBinArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const progressArg = rawBinArgs.findLast(isProgressFlag) !== '--no-progress'
  const binArgs = rawBinArgs.filter(a => !isProgressFlag(a))
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const isSilent = !useDebug && !binArgs.some(isLoglevelFlag)
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
            // Lazily access constants.distInstrumentWithSentryPath.
            constants.distInstrumentWithSentryPath
          ]
        : []),
      '--require',
      // Lazily access constants.distShadowNpmInjectPath.
      constants.distShadowNpmInjectPath,
      // Lazily access constants.shadowBinPath.
      await installLinks(constants.shadowBinPath, binName),
      // Add '--no-progress' to fix input being swallowed by the npm spinner.
      '--no-progress',
      // Add '--loglevel=error' if a loglevel flag is not provided and the
      // SOCKET_CLI_DEBUG environment variable is not truthy.
      ...logLevelArgs,
      ...binArgs,
      ...otherArgs
    ],
    {
      // 'inherit' + 'ipc'
      stdio: [0, 1, 2, 'ipc']
    }
  )
  // See https://nodejs.org/api/all.html#all_child_process_event-exit.
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
      [SOCKET_CLI_SAFE_PROGRESS]: progressArg
    }
  })
  await spawnPromise
}
