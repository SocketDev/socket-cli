import { fileURLToPath } from 'node:url'

import { debug, debugDir } from '@socketsecurity/lib-internal/debug'
import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'
import { readPackageJson } from '@socketsecurity/lib-internal/packages'

import { FLAG_DRY_RUN } from '../constants/cli.mts'
import { PACKAGE_JSON } from '../constants/packages.mts'
import {
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_VIEW_ALL_RISKS,
} from '../constants/shadow.mts'
import { debugScan } from '../utils/debug.mts'
import { safeNpmSpecToPurl } from '../utils/npm/spec.mts'
import { isAddCommand } from '../utils/process/cmd.mts'
import { getAlertsMapFromPurls } from '../utils/socket/alerts.mts'
import { logAlertsMap } from '../utils/socket/package-alert.mts'

import type { AlertsByPurl } from '../utils/socket/package-alert.mts'
import type { Spinner } from '@socketsecurity/lib-internal/spinner'

/**
 * Extract package PURLs from command arguments for add/dlx commands where
 * packages are specified as arguments.
 * Used by: pnpm, yarn.
 */
function extractPackagePurlsFromCommandArgs(
  rawArgs: string[] | readonly string[],
): string[] {
  const packagePurls: string[] = []

  // For 'add package1 package2@version' or 'dlx package', get packages from args.
  const packageArgs = rawArgs
    .slice(1)
    .filter(a => !a.startsWith('-') && a !== '--')

  for (const pkgSpec of packageArgs) {
    const purl = safeNpmSpecToPurl(pkgSpec)
    if (purl) {
      packagePurls.push(purl)
    }
  }

  return packagePurls
}

/**
 * Extract package PURLs from package.json for install/update commands.
 * Used by: pnpm, yarn.
 */
async function extractPackagePurlsFromPackageJson(
  cwd = process.cwd(),
): Promise<string[]> {
  const packagePurls: string[] = []

  try {
    const pkgJson = await readPackageJson(cwd)

    if (!pkgJson) {
      return packagePurls
    }

    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
      ...pkgJson.optionalDependencies,
      ...pkgJson.peerDependencies,
    }

    for (const { 0: name, 1: version } of Object.entries(allDeps)) {
      const purl = safeNpmSpecToPurl(
        typeof version === 'string' ? `${name}@${version}` : name,
      )
      if (purl) {
        packagePurls.push(purl)
      }
    }

    debugScan('start', packagePurls.length)
  } catch (e) {
    debug(`${PACKAGE_JSON} not found or invalid during dependency scanning`)
    debugDir(e)
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

  if (isDlxCommand || isAddCommand(command)) {
    packagePurls = extractPackagePurlsFromCommandArgs(rawArgs)
  } else if (isInstallCommand) {
    // For install/update, scan dependencies from package.json.
    // Note: This scans direct dependencies only.
    packagePurls = await extractPackagePurlsFromPackageJson(cwd)
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
          : `\nView all risks - Rerun with environment variable ${SOCKET_CLI_VIEW_ALL_RISKS}=1.`
      }${
        acceptRisks
          ? ''
          : `\nAccept risks - Rerun with environment variable ${SOCKET_CLI_ACCEPT_RISKS}=1.`
      }`.trim()

      const logger = getDefaultLogger()
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
