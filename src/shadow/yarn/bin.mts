import { fileURLToPath } from 'node:url'

import { debugNs } from '@socketsecurity/lib/debug'
import { spawn } from '@socketsecurity/lib/spawn'
import { YARN } from '@socketsecurity/registry/constants/agents'
import { WIN32 } from '@socketsecurity/registry/constants/platform'

import ENV from '../../constants/env.mts'
import { shadowBinPath } from '../../constants/paths.mts'
import {
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_BIN,
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_IPC_HANDSHAKE,
} from '../../constants/shadow.mts'
import { cmdFlagsToString } from '../../utils/process/cmd.mts'
import { installYarnLinks } from '../../utils/shadow/links.mts'
import { getPublicApiToken } from '../../utils/socket/sdk.mjs'
import { scanPackagesAndLogAlerts } from '../common.mts'
import { ensureIpcInStdio } from '../stdio-ipc.mts'

import type { IpcObject } from '../../constants/shadow.mts'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/lib/spawn'

export type ShadowYarnOptions = SpawnOptions & {
  ipc?: IpcObject | undefined
}

export type ShadowYarnResult = {
  spawnPromise: SpawnResult
}

const DLX_COMMANDS = new Set(['dlx'])

const INSTALL_COMMANDS = new Set([
  'add',
  'install',
  'up',
  'upgrade',
  'upgrade-interactive',
])

export default async function shadowYarnBin(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowYarnOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowYarnResult> {
  const opts = { __proto__: null, ...options } as ShadowYarnOptions
  const { env: spawnEnv, ipc, ...spawnOpts } = opts

  let { cwd = process.cwd() } = opts
  if (cwd instanceof URL) {
    cwd = fileURLToPath(cwd)
  }

  const terminatorPos = args.indexOf('--')
  const rawYarnArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)

  const { spinner } = opts
  const wasSpinning = !!spinner?.isSpinning

  spinner?.start()

  // Check for package scanning.
  const command = rawYarnArgs[0]
  const scanResult = await scanPackagesAndLogAlerts({
    acceptRisks: !!ENV.SOCKET_CLI_ACCEPT_RISKS,
    command,
    cwd,
    dlxCommands: DLX_COMMANDS,
    installCommands: INSTALL_COMMANDS,
    managerName: YARN,
    rawArgs: rawYarnArgs,
    spinner,
    viewAllRisks: !!ENV.SOCKET_CLI_VIEW_ALL_RISKS,
  })

  if (scanResult.shouldExit) {
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
    // This line is never reached in production, but helps tests.
    throw new Error('process.exit called')
  }

  const realYarnPath = await installYarnLinks(shadowBinPath)

  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const suffixArgs = [...rawYarnArgs, ...otherArgs]

  debugNs(
    'notice',
    `spawn: ${YARN} shadow bin ${realYarnPath} ${cmdFlagsToString(suffixArgs)}`,
  )

  if (wasSpinning) {
    spinner?.start()
  }

  // Set up stdio with IPC channel.
  const stdio = ensureIpcInStdio(spawnOpts.stdio)

  const spawnPromise = spawn(
    realYarnPath,
    suffixArgs,
    {
      ...spawnOpts,
      cwd,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio,
      // On Windows, yarn is often a .cmd file that requires shell execution.
      // The spawn function from @socketsecurity/registry will handle this properly
      // when shell is true.
      shell: WIN32,
    },
    extra,
  )

  // Send IPC handshake.
  spawnPromise.process.send({
    [SOCKET_IPC_HANDSHAKE]: {
      [SOCKET_CLI_SHADOW_API_TOKEN]: getPublicApiToken(),
      [SOCKET_CLI_SHADOW_BIN]: YARN,
      [SOCKET_CLI_SHADOW_PROGRESS]: true,
      ...ipc,
    },
  })

  return { spawnPromise }
}
