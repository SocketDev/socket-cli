import { existsSync } from 'node:fs'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { installLinks } from './link.mts'
import constants from '../../constants.mts'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../utils/alerts-map.mts'
import { cmdFlagsToString } from '../../utils/cmd.mts'
import { parsePnpmLockfile, readPnpmLockfile } from '../../utils/pnpm.mts'
import { logAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToNpmPurl } from '../../utils/spec.mts'

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
  spawnPromise: SpawnResult<string, SpawnExtra | undefined>
}

const INSTALL_COMMANDS = new Set([
  'add',
  'i',
  'install',
  'install-test',
  'it',
  'update',
  'up',
])

export default async function shadowPnpm(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowPnpmOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowPnpmResult> {
  const {
    env: spawnEnv,
    ipc,
    ...spawnOpts
  } = { __proto__: null, ...options } as ShadowPnpmOptions
  const terminatorPos = args.indexOf('--')
  const rawPnpmArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)

  // Check if this is an install-type command that needs security scanning
  const command = rawPnpmArgs[0]
  const needsScanning = command && INSTALL_COMMANDS.has(command)

  // Get pnpm path
  const realPnpmPath = await installLinks(constants.shadowBinPath, 'pnpm')

  const permArgs = [
    '--reporter=silent',
    // Disable update checks during security scanning
    '--no-update-notifier',
  ]

  const prefixArgs: string[] = []
  const suffixArgs = [...rawPnpmArgs, ...permArgs, ...otherArgs]

  if (needsScanning && !rawPnpmArgs.includes('--dry-run')) {
    const acceptRisks = constants.ENV.SOCKET_CLI_ACCEPT_RISKS
    const viewAllRisks = constants.ENV.SOCKET_CLI_VIEW_ALL_RISKS

    // Extract package names from command arguments before any downloads
    const packagePurls: string[] = []

    if (command === 'add') {
      // For 'pnpm add package1 package2@version', get packages from args
      const packageArgs = rawPnpmArgs
        .slice(1)
        .filter(arg => !arg.startsWith('-') && arg !== '--')

      for (const pkgSpec of packageArgs) {
        // Handle package specs like 'lodash', 'lodash@4.17.21', '@types/node@^20.0.0'
        let name: string
        let version: string | undefined

        if (pkgSpec.startsWith('@')) {
          // Scoped package: @scope/name or @scope/name@version
          const parts = pkgSpec.split('@')
          if (parts.length === 2) {
            // @scope/name (no version)
            name = pkgSpec
          } else {
            // @scope/name@version
            name = `@${parts[1]}`
            version = parts[2]
          }
        } else {
          // Regular package: name or name@version
          const atIndex = pkgSpec.indexOf('@')
          if (atIndex === -1) {
            name = pkgSpec
          } else {
            name = pkgSpec.slice(0, atIndex)
            version = pkgSpec.slice(atIndex + 1)
          }
        }

        if (name) {
          packagePurls.push(
            version ? idToNpmPurl(`${name}@${version}`) : idToNpmPurl(name),
          )
        }
      }
    } else if (['install', 'i', 'update', 'up'].includes(command)) {
      // For install/update, scan all dependencies from pnpm-lock.yaml
      const pnpmLockPath = 'pnpm-lock.yaml'
      if (existsSync(pnpmLockPath)) {
        try {
          const lockfileContent = await readPnpmLockfile(pnpmLockPath)
          if (lockfileContent) {
            const lockfile = parsePnpmLockfile(lockfileContent)
            if (lockfile) {
              // Use existing function to scan the entire lockfile
              if (isDebug()) {
                console.debug(
                  '[Socket] Scanning all dependencies from pnpm-lock.yaml',
                )
              }

              const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
                nothrow: true,
                filter: acceptRisks
                  ? { actions: ['error'], blocked: true }
                  : { actions: ['error', 'monitor', 'warn'] },
              })

              if (alertsMap.size) {
                process.exitCode = 1
                logAlertsMap(alertsMap, {
                  hideAt: viewAllRisks ? 'none' : 'middle',
                  output: process.stderr,
                })

                const errorMessage = `
Socket pnpm exiting due to risks.${
                  viewAllRisks
                    ? ''
                    : `\nView all risks - Rerun with environment variable ${constants.SOCKET_CLI_VIEW_ALL_RISKS}=1.`
                }${
                  acceptRisks
                    ? ''
                    : `\nAccept risks - Rerun with environment variable ${constants.SOCKET_CLI_ACCEPT_RISKS}=1.`
                }`.trim()

                console.error(errorMessage)
                // eslint-disable-next-line n/no-process-exit
                process.exit(1)
              }

              // Return early since we've already done the scanning
              if (isDebug()) {
                console.debug(
                  '[Socket] Lockfile scanning complete, proceeding with install',
                )
              }
            }
          }
        } catch (e) {
          if (isDebug()) {
            console.debug('[Socket] Error scanning pnpm lockfile:', e)
          }
        }
      } else if (isDebug()) {
        console.debug(
          '[Socket] No pnpm-lock.yaml found, skipping bulk install scanning',
        )
      }
    }

    if (packagePurls.length > 0) {
      if (isDebug()) {
        console.debug(
          '[Socket] Scanning packages before download:',
          packagePurls,
        )
      }

      try {
        const alertsMap = await getAlertsMapFromPurls(packagePurls, {
          nothrow: true,
          filter: acceptRisks
            ? { actions: ['error'], blocked: true }
            : { actions: ['error', 'monitor', 'warn'] },
        })

        if (alertsMap.size) {
          process.exitCode = 1
          logAlertsMap(alertsMap, {
            hideAt: viewAllRisks ? 'none' : 'middle',
            output: process.stderr,
          })

          const errorMessage = `
Socket pnpm exiting due to risks.${
            viewAllRisks
              ? ''
              : `\nView all risks - Rerun with environment variable ${constants.SOCKET_CLI_VIEW_ALL_RISKS}=1.`
          }${
            acceptRisks
              ? ''
              : `\nAccept risks - Rerun with environment variable ${constants.SOCKET_CLI_ACCEPT_RISKS}=1.`
          }`.trim()

          console.error(errorMessage)
          // eslint-disable-next-line n/no-process-exit
          process.exit(1)
        }
      } catch (e) {
        if (isDebug()) {
          console.debug('[Socket] Error during package scanning:', e)
        }
        // Continue with installation if scanning fails
      }
    }

    if (isDebug()) {
      console.debug(
        '[Socket] Scanning complete, proceeding with install:',
        rawPnpmArgs.slice(1),
      )
    }
  }

  const argsToString = cmdFlagsToString([...prefixArgs, ...suffixArgs])
  const env = {
    ...process.env,
    ...spawnEnv,
  } as Record<string, string>

  if (isDebug()) {
    console.debug(
      `[Socket] pnpm shadow bin spawn: ${realPnpmPath} ${argsToString}`,
    )
  }

  const spawnPromise = spawn(realPnpmPath, [...prefixArgs, ...suffixArgs], {
    ...spawnOpts,
    env,
    extra,
  })

  return { spawnPromise }
}
