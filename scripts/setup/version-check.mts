/**
 * @file Version comparison and prerequisite-checking helpers shared by
 *   scripts/setup.mts. Split out of setup.mts to keep each module under the
 *   fleet file-size cap.
 */

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

export interface VersionInfo {
  major: number
  minor: number
  patch: number
}

export interface PrerequisiteOptions {
  command: string
  minVersion?: VersionInfo | undefined
  name: string
  required?: boolean | undefined
}

/**
 * Compare two version objects. Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareVersions(a: VersionInfo, b: VersionInfo): number {
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1
  }
  return 0
}

/**
 * Get version of a command.
 */
export async function getVersion(
  command: string,
  args: string[] = ['--version'],
): Promise<string | undefined> {
  try {
    // shell: WIN32 — pnpm/gh resolve to .cmd shims on Windows, which only a
    // shell can execute.
    const result = await spawn(command, args, {
      shell: WIN32,
      stdio: 'pipe',
    })
    if (result.code === 0) {
      return String(result.stdout).trim()
    }
  } catch {
    // Ignore.
  }
  return undefined
}

/**
 * Check if a command is available.
 */
export async function hasCommand(command: string): Promise<boolean> {
  try {
    // shell: WIN32 — see getVersion above.
    const result = await spawn(command, ['--version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Parse version string to compare.
 */
function parseVersion(versionString: string): VersionInfo | undefined {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return undefined
  }
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
  }
}

/**
 * Check prerequisite.
 */
export async function checkPrerequisite({
  command,
  minVersion,
  name,
  required = true,
}: PrerequisiteOptions): Promise<boolean> {
  const version = await getVersion(command)

  if (!version) {
    logger.error(`${name} not found`)
    return false
  }

  if (minVersion) {
    const current = parseVersion(version)
    if (!current) {
      logger.warn(`Could not parse ${name} version: ${version}`)
      return !required
    }

    if (compareVersions(current, minVersion) < 0) {
      const minVersionStr = `${minVersion.major}.${minVersion.minor}.${minVersion.patch}`
      logger.error(`${name} ${version} found, but >=${minVersionStr} required`)
      return false
    }
  }

  logger.log(`${name} ${version}`)
  return true
}
