import { promises as fs } from 'node:fs'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { installLinks } from './link.mts'
import constants from '../../constants.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'
import { cmdFlagsToString } from '../../utils/cmd.mts'
import { logAlertsMap } from '../../utils/socket-package-alert.mts'
import { idToNpmPurl } from '../../utils/spec.mts'

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

const INSTALL_COMMANDS = new Set([
  'add',
  'install',
  'up',
  'upgrade',
  'upgrade-interactive',
])

const DLX_COMMANDS = new Set(['dlx'])

export default async function shadowYarn(
  args: string[] | readonly string[] = process.argv.slice(2),
  options?: ShadowYarnOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<ShadowYarnResult> {
  const {
    env: spawnEnv,
    ipc,
    ...spawnOpts
  } = { __proto__: null, ...options } as ShadowYarnOptions
  const terminatorPos = args.indexOf('--')
  const rawYarnArgs = terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)

  // Check if this is a command that needs security scanning
  const command = rawYarnArgs[0]
  const needsScanning =
    command && (INSTALL_COMMANDS.has(command) || DLX_COMMANDS.has(command))

  // Get yarn path
  const realYarnPath = await installLinks(constants.shadowBinPath, 'yarn')

  const permArgs: string[] = []

  const prefixArgs: string[] = []
  const suffixArgs = [...rawYarnArgs, ...permArgs, ...otherArgs]

  if (needsScanning && !rawYarnArgs.includes('--dry-run')) {
    const acceptRisks = constants.ENV.SOCKET_CLI_ACCEPT_RISKS
    const viewAllRisks = constants.ENV.SOCKET_CLI_VIEW_ALL_RISKS

    // Extract package names from command arguments before any downloads
    const packagePurls: string[] = []

    if (command === 'add' || command === 'dlx') {
      // For 'yarn add package1 package2@version' or 'yarn dlx package'
      const packageArgs = rawYarnArgs
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
    } else if (
      ['install', 'up', 'upgrade', 'upgrade-interactive'].includes(command)
    ) {
      // For install/upgrade, scan all dependencies from package.json
      // Note: This scans direct dependencies only. For full transitive dependency
      // scanning, yarn.lock parsing would be needed (not yet implemented)
      try {
        const packageJsonContent = await fs.readFile('package.json', 'utf8')
        const packageJson = JSON.parse(packageJsonContent)

        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
          ...packageJson.optionalDependencies,
          ...packageJson.peerDependencies,
        }

        for (const [name, version] of Object.entries(allDeps)) {
          if (typeof version === 'string') {
            packagePurls.push(idToNpmPurl(`${name}@${version}`))
          } else {
            packagePurls.push(idToNpmPurl(name))
          }
        }

        if (isDebug()) {
          console.debug(
            `[Socket] Scanning ${packagePurls.length} direct dependencies from package.json`,
          )
          console.debug(
            '[Socket] Note: Transitive dependencies not scanned (yarn.lock parsing not implemented)',
          )
        }
      } catch (e) {
        if (isDebug()) {
          console.debug(
            '[Socket] Could not read package.json for dependency scanning:',
            e,
          )
        }
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
Socket yarn exiting due to risks.${
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
        rawYarnArgs.slice(1),
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
      `[Socket] yarn shadow bin spawn: ${realYarnPath} ${argsToString}`,
    )
  }

  const spawnPromise = spawn(realYarnPath, [...prefixArgs, ...suffixArgs], {
    ...spawnOpts,
    env,
    extra,
  })

  return { spawnPromise }
}
