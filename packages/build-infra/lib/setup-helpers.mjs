/**
 * @fileoverview Setup and prerequisite checking utilities.
 * Provides helpers for checking and installing required development tools.
 */

import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { WIN32 } from '@socketsecurity/lib/constants/platform'

const logger = getDefaultLogger()

/**
 * Check if a command is available.
 *
 * @param {string} command - Command to check
 * @returns {Promise<boolean>} True if command exists
 */
export async function hasCommand(command) {
  try {
    const result = await spawn(command, ['--version'], {
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Get version string of a command.
 *
 * @param {string} command - Command to check
 * @param {string[]} args - Arguments (defaults to ['--version'])
 * @returns {Promise<string|null>} Version string or null
 */
export async function getVersion(command, args = ['--version']) {
  try {
    const result = await spawn(command, args, {
      stdio: 'pipe',
    })
    if (result.code === 0) {
      return result.stdout.trim()
    }
  } catch {
    // Ignore.
  }
  return null
}

/**
 * Parse version string to comparable object.
 *
 * @param {string} versionString - Version string (e.g., "v1.2.3" or "1.2.3")
 * @returns {object|null} Version object {major, minor, patch} or null
 */
export function parseVersion(versionString) {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

/**
 * Compare two version objects.
 *
 * @param {object} a - Version object {major, minor, patch}
 * @param {object} b - Version object {major, minor, patch}
 * @returns {number} -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * Check if Homebrew is installed (macOS/Linux).
 *
 * @returns {Promise<boolean>} True if brew is available
 */
export async function hasHomebrew() {
  return hasCommand('brew')
}

/**
 * Check if Chocolatey is installed (Windows).
 *
 * @returns {Promise<boolean>} True if choco is available
 */
export async function hasChocolatey() {
  return hasCommand('choco')
}

/**
 * Install Homebrew (macOS/Linux).
 * Does not pin version - uses latest stable from official installer.
 *
 * @returns {Promise<boolean>} True if installation succeeded
 */
export async function installHomebrew() {
  if (WIN32) {
    logger.warn('Homebrew is not available on Windows')
    return false
  }

  logger.step('Installing Homebrew...')
  logger.info('This requires sudo access and may take a few minutes')

  const installScript = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

  const result = await spawn('bash', ['-c', installScript], {
    stdio: 'inherit',
  })

  if (result.code === 0) {
    logger.success('Homebrew installed successfully!')
    return true
  }

  logger.error('Failed to install Homebrew')
  return false
}

/**
 * Install Chocolatey (Windows).
 * Does not pin version - uses latest stable from official installer.
 *
 * @returns {Promise<boolean>} True if installation succeeded
 */
export async function installChocolatey() {
  if (!WIN32) {
    logger.warn('Chocolatey is only available on Windows')
    return false
  }

  logger.step('Installing Chocolatey...')
  logger.info('This requires admin access and may take a few minutes')

  const installScript = 'Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://community.chocolatey.org/install.ps1\'))'

  const result = await spawn('powershell', ['-Command', installScript], {
    stdio: 'inherit',
  })

  if (result.code === 0) {
    logger.success('Chocolatey installed successfully!')
    return true
  }

  logger.error('Failed to install Chocolatey')
  logger.info('You may need to run as Administrator')
  return false
}

/**
 * Install a package using Homebrew.
 *
 * @param {string} packageName - Package name
 * @returns {Promise<boolean>} True if installation succeeded
 */
export async function installWithHomebrew(packageName) {
  if (!await hasHomebrew()) {
    logger.error('Homebrew not available')
    return false
  }

  logger.step(`Installing ${packageName} with Homebrew...`)

  const result = await spawn('brew', ['install', packageName], {
    stdio: 'inherit',
  })

  if (result.code === 0) {
    logger.success(`${packageName} installed successfully!`)
    return true
  }

  logger.error(`Failed to install ${packageName}`)
  return false
}

/**
 * Install a package using Chocolatey.
 *
 * @param {string} packageName - Package name
 * @returns {Promise<boolean>} True if installation succeeded
 */
export async function installWithChocolatey(packageName) {
  if (!await hasChocolatey()) {
    logger.error('Chocolatey not available')
    return false
  }

  logger.step(`Installing ${packageName} with Chocolatey...`)

  const result = await spawn('choco', ['install', packageName, '-y'], {
    stdio: 'inherit',
  })

  if (result.code === 0) {
    logger.success(`${packageName} installed successfully!`)
    return true
  }

  logger.error(`Failed to install ${packageName}`)
  logger.info('You may need to run as Administrator')
  return false
}

/**
 * Install gh CLI.
 *
 * @param {object} options - Installation options
 * @param {boolean} options.autoInstall - Automatically install without prompting
 * @returns {Promise<boolean>} True if installation succeeded or already installed
 */
export async function installGhCli({ autoInstall = false } = {}) {
  // Check if already installed.
  if (await hasCommand('gh')) {
    return true
  }

  if (!autoInstall) {
    logger.info('gh CLI not found')
    logger.info('Install from: https://cli.github.com/')
    return false
  }

  // Windows: Try Chocolatey.
  if (WIN32) {
    if (!await hasChocolatey()) {
      logger.info('Chocolatey not found. Install Chocolatey first to auto-install gh CLI.')
      logger.info('Chocolatey: https://chocolatey.org/install')
      logger.info('gh CLI: https://cli.github.com/')
      return false
    }
    return installWithChocolatey('gh')
  }

  // macOS/Linux: Try Homebrew.
  if (!await hasHomebrew()) {
    logger.info('Homebrew not found. Install Homebrew first to auto-install gh CLI.')
    logger.info('Homebrew: https://brew.sh/')
    logger.info('gh CLI: https://cli.github.com/')
    return false
  }

  return installWithHomebrew('gh')
}

/**
 * Check prerequisite with auto-install option.
 *
 * @param {object} options - Check options
 * @param {string} options.command - Command to check
 * @param {string} options.name - Human-readable name
 * @param {object} options.minVersion - Minimum version {major, minor, patch}
 * @param {boolean} options.required - Whether this is required
 * @param {Function} options.installer - Optional installer function
 * @param {boolean} options.autoInstall - Auto-install if missing
 * @returns {Promise<{ok: boolean, version: string|null, installed: boolean}>}
 */
export async function checkPrerequisite({
  autoInstall = false,
  command,
  installer,
  minVersion,
  name,
  required = true,
}) {
  const version = await getVersion(command)

  if (!version) {
    if (!required) {
      logger.info(`${name} not found (optional)`)
      if (installer && autoInstall) {
        logger.step(`Attempting to install ${name}...`)
        const installed = await installer({ autoInstall: true })
        if (installed) {
          const newVersion = await getVersion(command)
          return { installed: true, ok: true, version: newVersion }
        }
      }
      return { installed: false, ok: true, version: null }
    }

    logger.error(`${name} not found`)

    if (installer && autoInstall) {
      logger.step(`Attempting to install ${name}...`)
      const installed = await installer({ autoInstall: true })
      if (installed) {
        const newVersion = await getVersion(command)
        return { installed: true, ok: true, version: newVersion }
      }
      return { installed: false, ok: false, version: null }
    }

    return { installed: false, ok: false, version: null }
  }

  // Check version if minimum specified.
  if (minVersion) {
    const current = parseVersion(version)
    if (!current) {
      logger.warn(`Could not parse version: ${version}`)
      return { installed: false, ok: !required, version }
    }

    if (compareVersions(current, minVersion) < 0) {
      const minVersionStr = `${minVersion.major}.${minVersion.minor}.${minVersion.patch}`
      logger.error(`${name} ${version} found, but >=${minVersionStr} required`)
      return { installed: false, ok: false, version }
    }
  }

  logger.success(`${name} ${version}`)
  return { installed: false, ok: true, version }
}
