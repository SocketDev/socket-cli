/**
 * @file Optional-tool installer helpers (gh CLI, Homebrew, Chocolatey) shared
 *   by scripts/setup.mts. Split out of setup.mts to keep each module under
 *   the fleet file-size cap.
 */

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getVersion, hasCommand } from './version-check.mts'

const logger = getDefaultLogger()

export interface EnsureGhCliOptions {
  autoInstall: boolean
}

/**
 * Install Chocolatey (Windows).
 */
async function installChocolatey(): Promise<boolean> {
  if (!WIN32) {
    logger.warn('Chocolatey is only available on Windows')
    return false
  }

  logger.step('Installing Chocolatey…')
  logger.info('This requires admin access and may take a few minutes')

  const installScript =
    "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"

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
 * Install Homebrew (macOS/Linux).
 */
async function installHomebrew(): Promise<boolean> {
  if (WIN32) {
    logger.warn('Homebrew is not available on Windows')
    return false
  }

  logger.step('Installing Homebrew…')
  logger.info('This requires sudo access and may take a few minutes')

  const installScript =
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

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
 * Install a package using Chocolatey (Windows).
 */
async function installWithChocolatey(packageName: string): Promise<boolean> {
  if (!(await hasCommand('choco'))) {
    logger.error('Chocolatey not available')
    return false
  }

  logger.step(`Installing ${packageName} with Chocolatey…`)

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
 * Install a package using Homebrew (macOS/Linux).
 */
async function installWithHomebrew(packageName: string): Promise<boolean> {
  if (!(await hasCommand('brew'))) {
    logger.error('Homebrew not available')
    return false
  }

  logger.step(`Installing ${packageName} with Homebrew…`)

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
 * Check and optionally install gh CLI.
 */
export async function ensureGhCli({
  autoInstall,
}: EnsureGhCliOptions): Promise<boolean> {
  if (await hasCommand('gh')) {
    const version = await getVersion('gh')
    logger.log(`gh CLI ${version} (optional)`)
    return true
  }

  if (!autoInstall) {
    logger.info('gh CLI not found (optional - enables cache restoration)')
    logger.info('Install from: https://cli.github.com/')
    logger.info('Or run: pnpm run setup --install')
    return false
  }

  // Auto-install mode.
  if (WIN32) {
    // Windows: Try Chocolatey.
    if (!(await hasCommand('choco'))) {
      logger.info('Chocolatey not found (needed for auto-install on Windows)')
      logger.log('Attempting to install Chocolatey…')
      const installed = await installChocolatey()
      if (!installed) {
        logger.warn('Could not install Chocolatey')
        logger.info('Install gh CLI manually from: https://cli.github.com/')
        logger.info(
          'Or install Chocolatey from: https://chocolatey.org/install',
        )
        return false
      }
    }

    // Install gh CLI with Chocolatey.
    logger.log('Installing gh CLI with Chocolatey…')
    const installed = await installWithChocolatey('gh')
    if (installed) {
      // Verify gh is actually available after installation.
      if (await hasCommand('gh')) {
        const version = await getVersion('gh')
        logger.log(`gh CLI ${version} installed!`)
        return true
      }
      logger.warn('gh CLI installed but not available in PATH')
      logger.info('You may need to restart your shell or run: pnpm run setup')
      return false
    }

    logger.warn('Could not install gh CLI')
    logger.info('Install manually from: https://cli.github.com/')
    return false
  }

  // macOS/Linux: Try Homebrew.
  if (!(await hasCommand('brew'))) {
    logger.info('Homebrew not found (needed for auto-install)')
    logger.log('Attempting to install Homebrew…')
    const installed = await installHomebrew()
    if (!installed) {
      logger.warn('Could not install Homebrew')
      logger.info('Install gh CLI manually from: https://cli.github.com/')
      return false
    }
  }

  // Install gh CLI with Homebrew.
  logger.log('Installing gh CLI with Homebrew…')
  const installed = await installWithHomebrew('gh')
  if (installed) {
    // Verify gh is actually available after installation.
    if (await hasCommand('gh')) {
      const version = await getVersion('gh')
      logger.log(`gh CLI ${version} installed!`)
      return true
    }
    logger.warn('gh CLI installed but not available in PATH')
    logger.info('You may need to restart your shell or run: pnpm run setup')
    return false
  }

  logger.warn('Could not install gh CLI')
  logger.info('Install manually from: https://cli.github.com/')
  return false
}
