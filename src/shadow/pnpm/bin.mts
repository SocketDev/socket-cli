import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { debug, debugDir, debugNs } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, {
  FLAG_DRY_RUN,
  PNPM,
  PNPM_LOCK_YAML,
} from '../../constants.mts'
import { getAlertsMapFromPnpmLockfile } from '../../utils/alerts-map.mts'
import {
  cmdFlagsToString,
  isAddCommand,
  isPnpmLockfileScanCommand,
} from '../../utils/cmd.mts'
import { parsePnpmLockfile, readPnpmLockfile } from '../../utils/pnpm.mts'
import { getPublicApiToken } from '../../utils/sdk.mts'
import { installPnpmLinks } from '../../utils/shadow-links.mts'
import { logAlertsMap } from '../../utils/socket-package-alert.mts'
import { scanPackagesAndLogAlerts } from '../common.mts'
import { ensureIpcInStdio } from '../stdio-ipc.mts'

import type { IpcObject } from '../../constants.mts'
import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/registry/lib/spawn'

export type ShadowPnpmOptions = SpawnOptions & {
  ipc?: IpcObject | undefined
}

export type ShadowPnpmResult = {
  spawnPromise: SpawnResult
}

const DLX_COMMANDS = new Set(['dlx'])

const INSTALL_COMMANDS = new Set([
  'add',
  'i',
  'install',
  'install-test',
  'it',
  'update',
  'up',
])

export default async function shadowPnpmBin(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowPnpmOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowPnpmResult> {
  const opts = { __proto__: null, ...options } as ShadowPnpmOptions
  const { env: spawnEnv, ipc, ...spawnOpts } = opts

  let { cwd = process.cwd() } = opts
  if (cwd instanceof URL) {
    cwd = fileURLToPath(cwd)
  }

  const terminatorPos = args.indexOf('--')
  const rawPnpmArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)

  const { spinner } = opts
  const wasSpinning = !!spinner?.isSpinning

  // Check if this is a command that needs security scanning.
  const command = rawPnpmArgs[0]
  const isDlxCommand = command && DLX_COMMANDS.has(command)
  const isInstallCommand = command && INSTALL_COMMANDS.has(command)
  const needsScanning = isDlxCommand || isInstallCommand

  spinner?.start()

  if (needsScanning && !rawPnpmArgs.includes(FLAG_DRY_RUN)) {
    const acceptRisks = !!constants.ENV.SOCKET_CLI_ACCEPT_RISKS
    const viewAllRisks = !!constants.ENV.SOCKET_CLI_VIEW_ALL_RISKS

    // Handle add and dlx commands with shared utility.
    if (isDlxCommand || isAddCommand(command)) {
      const scanResult = await scanPackagesAndLogAlerts({
        acceptRisks,
        command,
        cwd,
        dlxCommands: DLX_COMMANDS,
        installCommands: INSTALL_COMMANDS,
        managerName: PNPM,
        rawArgs: rawPnpmArgs,
        spinner,
        viewAllRisks,
      })

      if (scanResult.shouldExit) {
        // eslint-disable-next-line n/no-process-exit
        process.exit(1)
        // This line is never reached in production, but helps tests.
        throw new Error('process.exit called')
      }
    } else if (isPnpmLockfileScanCommand(command)) {
      // For install/update, scan all dependencies from pnpm-lock.yaml
      const pnpmLockPath = normalizePath(path.join(cwd, PNPM_LOCK_YAML))
      if (existsSync(pnpmLockPath)) {
        try {
          const lockfileContent = await readPnpmLockfile(pnpmLockPath)
          if (lockfileContent) {
            const lockfile = parsePnpmLockfile(lockfileContent)
            if (lockfile) {
              // Use existing function to scan the entire lockfile
              debug(`scanning: all dependencies from ${PNPM_LOCK_YAML}`)

              const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
                nothrow: true,
                filter: acceptRisks
                  ? { actions: ['error'], blocked: true }
                  : { actions: ['error', 'monitor', 'warn'] },
              })

              spinner?.stop()

              if (alertsMap.size) {
                process.exitCode = 1
                logAlertsMap(alertsMap, {
                  hideAt: viewAllRisks ? 'none' : 'middle',
                  output: process.stderr,
                })

                const errorMessage = `Socket ${PNPM} exiting due to risks.${
                  viewAllRisks
                    ? ''
                    : `\nView all risks - Rerun with environment variable ${constants.SOCKET_CLI_VIEW_ALL_RISKS}=1.`
                }${
                  acceptRisks
                    ? ''
                    : `\nAccept risks - Rerun with environment variable ${constants.SOCKET_CLI_ACCEPT_RISKS}=1.`
                }`.trim()

                logger.error(errorMessage)
                // eslint-disable-next-line n/no-process-exit
                process.exit(1)
                // This line is never reached in production, but helps tests.
                throw new Error('process.exit called')
              }

              // Return early since we've already done the scanning
              debug('complete: lockfile scanning, proceeding with install')
            }
          }
        } catch (e) {
          debug(`${PNPM} lockfile scanning failed`)
          debugDir(e)
        }
      } else {
        debug(
          `skip: no ${PNPM_LOCK_YAML} found, skipping bulk install scanning`,
        )
      }
    }

    debug('complete: scanning, proceeding with install')
  }

  const realPnpmPath = await installPnpmLinks(constants.shadowBinPath)

  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const suffixArgs = [...rawPnpmArgs, ...otherArgs]

  debugNs(
    'notice',
    `spawn: ${PNPM} shadow bin ${realPnpmPath} ${cmdFlagsToString(suffixArgs)}`,
  )

  if (wasSpinning) {
    spinner?.start()
  }

  // Set up stdio with IPC channel.
  const stdio = ensureIpcInStdio(spawnOpts.stdio)

  const spawnPromise = spawn(
    realPnpmPath,
    suffixArgs,
    {
      ...spawnOpts,
      cwd,
      env: {
        ...process.env,
        ...spawnEnv,
      },
      stdio,
      // On Windows, pnpm is often a .cmd file that requires shell execution.
      // The spawn function from @socketsecurity/registry will handle this properly
      // when shell is true.
      shell: constants.WIN32,
    },
    extra,
  )

  // Send IPC handshake.
  spawnPromise.process.send({
    [constants.SOCKET_IPC_HANDSHAKE]: {
      [constants.SOCKET_CLI_SHADOW_API_TOKEN]: getPublicApiToken(),
      [constants.SOCKET_CLI_SHADOW_BIN]: PNPM,
      [constants.SOCKET_CLI_SHADOW_PROGRESS]: true,
      ...ipc,
    },
  })

  return { spawnPromise }
}
