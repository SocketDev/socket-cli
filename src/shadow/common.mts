import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_DRY_RUN } from '../constants.mts'
import { getAlertsMapFromPurls } from '../utils/alerts-map.mts'
import { debugScan } from '../utils/debug.mts'
import { safeNpmSpecToPurl } from '../utils/npm-spec.mts'
import { logAlertsMap } from '../utils/socket-package-alert.mts'

import type { AlertsByPurl } from '../utils/socket-package-alert.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

/**
 * Extract package PURLs from add/dlx command arguments.
 */
export function extractPackagePurlsFromArgs(
  command: string,
  rawArgs: string[] | readonly string[],
  dlxCommands?: Set<string>,
): string[] {
  const packagePurls: string[] = []
  const isDlxCommand = dlxCommands?.has(command)

  if (command === 'add' || isDlxCommand) {
    // For 'add package1 package2@version' or 'dlx package', get packages from args.
    const packageArgs = rawArgs
      .slice(1)
      .filter(arg => !arg.startsWith('-') && arg !== '--')

    for (const pkgSpec of packageArgs) {
      const purl = safeNpmSpecToPurl(pkgSpec)
      if (purl) {
        packagePurls.push(purl)
      }
    }
  }

  return packagePurls
}

/**
 * Extract package PURLs from package.json for install/update commands.
 */
export async function extractPackagePurlsFromPackageJson(
  cwd: string,
  spinner?: Spinner,
): Promise<string[]> {
  const packagePurls: string[] = []

  try {
    const packageJsonContent = await fs.readFile(`${cwd}/package.json`, 'utf8')
    const packageJson = JSON.parse(packageJsonContent)

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
      ...packageJson.peerDependencies,
    }

    for (const [name, version] of Object.entries(allDeps)) {
      const purl = safeNpmSpecToPurl(
        typeof version === 'string' ? `${name}@${version}` : name,
      )
      if (purl) {
        packagePurls.push(purl)
      }
    }

    debugScan('start', packagePurls.length)
  } catch (e) {
    debugFn(
      'warn',
      'Package.json not found or invalid during dependency scanning',
    )
    debugDir('error', e)
  }

  return packagePurls
}

export type PackageScanOptions = {
  acceptRisks: boolean
  command: string | undefined
  cwd?: string | URL
  dlxCommands?: Set<string>
  installCommands: Set<string>
  managerName: string
  nothrow?: boolean
  rawArgs: string[] | readonly string[]
  spinner?: Spinner | undefined
  viewAllRisks: boolean
}

export type PackageScanResult = {
  alertsMap?: AlertsByPurl
  shouldExit: boolean
}

/**
 * Scan packages and log alerts if found.
 */
export async function scanPackagesAndLogAlerts(
  options: PackageScanOptions,
): Promise<PackageScanResult> {
  const {
    acceptRisks,
    command,
    dlxCommands,
    installCommands,
    managerName,
    nothrow = true,
    rawArgs,
    spinner,
    viewAllRisks,
  } = options

  let { cwd = process.cwd() } = options
  if (cwd instanceof URL) {
    cwd = fileURLToPath(cwd)
  }

  // Check if this is a command that needs security scanning.
  const isDlxCommand = dlxCommands && command && dlxCommands.has(command)
  const isInstallCommand = command && installCommands.has(command)
  const needsScanning = isDlxCommand || isInstallCommand

  if (!needsScanning || rawArgs.includes(FLAG_DRY_RUN)) {
    return { shouldExit: false }
  }

  // Extract package names from command arguments before any downloads.
  let packagePurls: string[] = []

  if (command === 'add' || isDlxCommand) {
    packagePurls = extractPackagePurlsFromArgs(command, rawArgs, dlxCommands)
  } else if (isInstallCommand) {
    // For install/update, scan dependencies from package.json.
    // Note: This scans direct dependencies only.
    packagePurls = await extractPackagePurlsFromPackageJson(cwd, spinner)
  }

  if (!packagePurls.length) {
    return { shouldExit: false }
  }

  debugScan('start', packagePurls.length)
  debugDir('inspect', { packagePurls })

  try {
    const alertsMap = await getAlertsMapFromPurls(packagePurls, {
      filter: acceptRisks
        ? { actions: ['error'], blocked: true }
        : { actions: ['error', 'monitor', 'warn'] },
      nothrow,
      spinner,
    })

    if (alertsMap.size) {
      process.exitCode = 1
      spinner?.stop()
      logAlertsMap(alertsMap, {
        hideAt: viewAllRisks ? 'none' : 'middle',
        output: process.stderr,
      })

      const errorMessage = `Socket ${managerName} exiting due to risks.${
        viewAllRisks
          ? ''
          : `\nView all risks - Rerun with environment variable ${constants.SOCKET_CLI_VIEW_ALL_RISKS}=1.`
      }${
        acceptRisks
          ? ''
          : `\nAccept risks - Rerun with environment variable ${constants.SOCKET_CLI_ACCEPT_RISKS}=1.`
      }`.trim()

      logger.error(errorMessage)
      return { alertsMap, shouldExit: true }
    }
  } catch (e) {
    spinner?.stop()
    // Re-throw process.exit errors from tests.
    if (e instanceof Error && e.message === 'process.exit called') {
      throw e
    }
    debugScan('error', undefined, e)
    // Continue with installation if scanning fails.
  }

  debugScan('complete', packagePurls.length)
  debugDir('inspect', { args: rawArgs.slice(1) })

  return { shouldExit: false }
}
