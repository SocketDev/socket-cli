import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { scanPackagesAndLogAlerts } from '../common.mts'
import { installLinks } from './link.mts'
import constants, { YARN } from '../../constants.mts'
import { cmdFlagsToString } from '../../utils/cmd.mts'

import type { IpcObject } from '../../constants.mts'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'

export type ShadowYarnOptions = SpawnOptions & {
  ipc?: IpcObject | undefined
}

export type ShadowYarnResult = {
  spawnPromise: SpawnResult<string, SpawnExtra | undefined>
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
  const { spinner } = opts

  const wasSpinning = !!spinner?.isSpinning

  spinner?.start()

  const terminatorPos = args.indexOf('--')
  const rawYarnArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)

  // Check for package scanning.
  const command = rawYarnArgs[0]
  const scanResult = await scanPackagesAndLogAlerts({
    acceptRisks: !!constants.ENV.SOCKET_CLI_ACCEPT_RISKS,
    command,
    cwd: process.cwd(),
    dlxCommands: DLX_COMMANDS,
    installCommands: INSTALL_COMMANDS,
    managerName: 'yarn',
    rawArgs: rawYarnArgs,
    spinner,
    viewAllRisks: !!constants.ENV.SOCKET_CLI_VIEW_ALL_RISKS,
  })

  if (scanResult.shouldExit) {
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
    // This line is never reached in production, but helps tests.
    throw new Error('process.exit called')
  }

  const realYarnPath = await installLinks(constants.shadowBinPath, YARN)

  spinner?.stop()

  const suffixArgs = [...rawYarnArgs, ...otherArgs]

  if (isDebug()) {
    debugFn(
      'notice',
      `spawn: ${YARN} shadow bin ${realYarnPath} ${cmdFlagsToString(suffixArgs)}`,
    )
  }

  if (wasSpinning) {
    spinner?.start()
  }

  const spawnPromise = spawn(realYarnPath, suffixArgs, {
    ...spawnOpts,
    env: {
      ...process.env,
      ...spawnEnv,
    },
    extra,
  })

  return { spawnPromise }
}
