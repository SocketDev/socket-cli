import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_DRY_RUN, NPM } from '../constants.mts'
import { getAlertsMapFromPurls } from '../utils/alerts-map.mts'
import { createPurlObject, getPurlObject } from '../utils/purl.mts'
import { logAlertsMap } from '../utils/socket-package-alert.mts'

import type { AlertsByPurl } from '../utils/socket-package-alert.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type ParsedPackageSpec = {
  name: string
  version: string | undefined
}

/**
 * Parse npm package specification into name and version.
 * Handles both regular packages (lodash@4.17.21) and scoped packages (@types/node@20.0.0).
 */
export function parseNpmPackageSpec(pkgSpec: string): ParsedPackageSpec {
  // Handle scoped packages first to avoid confusion with version delimiter.
  if (pkgSpec.startsWith('@')) {
    const scopedMatch = pkgSpec.match(/^(@[^/@]+\/[^/@]+)(?:@(.+))?$/)
    if (scopedMatch) {
      return {
        name: scopedMatch[1],
        version: scopedMatch[2],
      }
    }
  }

  // Handle regular packages.
  const atIndex = pkgSpec.indexOf('@')
  if (atIndex === -1) {
    return { name: pkgSpec, version: undefined }
  }

  return {
    name: pkgSpec.slice(0, atIndex),
    version: pkgSpec.slice(atIndex + 1),
  }
}

/**
 * Convert npm package spec to PURL string.
 */
export function npmSpecToPurl(pkgSpec: string): string {
  const { name, version } = parseNpmPackageSpec(pkgSpec)
  // Create PURL object to ensure proper formatting.
  const purlObj = createPurlObject({
    type: NPM,
    name,
    version,
    throws: false,
  })
  return purlObj?.toString() ?? `pkg:${NPM}/${name}${version ? `@${version}` : ''}`
}

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
      const purl = npmSpecToPurl(pkgSpec)
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
      const purl = npmSpecToPurl(
        typeof version === 'string' ? `${name}@${version}` : name,
      )
      if (purl) {
        packagePurls.push(purl)
      }
    }

    if (isDebug()) {
      spinner?.stop()
      debugFn(
        'notice',
        `scanning: ${packagePurls.length} direct dependencies from package.json`,
      )
      spinner?.start()
    }
  } catch (e) {
    if (isDebug()) {
      spinner?.stop()
      debugFn(
        'error',
        'caught: package.json read error during dependency scanning',
      )
      debugDir('inspect', { error: e })
      spinner?.start()
    }
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

  if (isDebug()) {
    spinner?.stop()
    debugFn('notice', 'scanning: packages before operation')
    debugDir('inspect', { packagePurls })
    spinner?.start()
  }

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
    if (isDebug()) {
      debugFn('error', 'caught: package scanning error')
      debugDir('inspect', { error: e })
    }
    // Continue with installation if scanning fails.
  }

  if (isDebug()) {
    spinner?.stop()
    debugFn('notice', 'complete: scanning, proceeding with operation')
    debugDir('inspect', { args: rawArgs.slice(1) })
  }

  return { shouldExit: false }
}
