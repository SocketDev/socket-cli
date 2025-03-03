import process from 'node:process'

import {
  isLoglevelFlag,
  isProgressFlag
} from '@socketsecurity/registry/lib/npm'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { installLinks } from './link'
import constants from '../constants'

const {
  SOCKET_CLI_SAFE_WRAPPER,
  SOCKET_CLI_SENTRY_BUILD,
  SOCKET_IPC_HANDSHAKE
} = constants

export default async function shadowBin(
  binName: 'npm' | 'npx',
  args = process.argv.slice(2)
) {
  process.exitCode = 1
  const terminatorPos = args.indexOf('--')
  const binArgs = (
    terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  ).filter(a => !isProgressFlag(a))
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const spawnPromise = spawn(
    // Lazily access constants.execPath.
    constants.execPath,
    [
      // Lazily access constants.nodeNoWarningsFlags.
      ...constants.nodeNoWarningsFlags,
      // Lazily access constants.ENV[SOCKET_CLI_SENTRY_BUILD].
      ...(constants.ENV[SOCKET_CLI_SENTRY_BUILD]
        ? [
            '--require',
            // Lazily access constants.instrumentWithSentryPath.
            constants.instrumentWithSentryPath
          ]
        : []),
      '--require',
      // Lazily access constants.npmInjectionPath.
      constants.npmInjectionPath,
      // Lazily access constants.shadowBinPath.
      await installLinks(constants.shadowBinPath, binName),
      // Add `--no-progress` and `--quiet` flags to fix input being swallowed by
      // the spinner when running the command with recent versions of npm.
      '--no-progress',
      // Add the '--quiet' flag if a loglevel flag is not provided.
      ...(binArgs.some(isLoglevelFlag) ? [] : ['--quiet']),
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
      process.exit(code)
    }
  })
  spawnPromise.process.send({
    [SOCKET_IPC_HANDSHAKE]: {
      [SOCKET_CLI_SAFE_WRAPPER]: true
    }
  })
  await spawnPromise
}
