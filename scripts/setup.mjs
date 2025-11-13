#!/usr/bin/env node
/**
 * @fileoverview Developer setup script - checks prerequisites and prepares environment.
 *
 * Checks and optionally installs:
 * - Node.js version (>=18.0.0)
 * - pnpm version (>=10.21.0)
 * - gh CLI (optional, for cache restoration)
 * - Homebrew (if needed for installations)
 *
 * Actions:
 * - Checks for required tools (Node.js, pnpm) and fails if missing
 * - Auto-installs optional tools (gh CLI, brew/choco) if --install flag provided
 * - Verifies installed tools are actually available in PATH before proceeding
 * - Attempts to restore build cache from CI (only if gh CLI available)
 * - Reports missing tools with installation instructions
 *
 * Usage:
 *   pnpm run setup                # Check prerequisites and restore cache
 *   pnpm run setup --install      # Check and auto-install optional tools, then restore cache
 *   pnpm run setup --restore-cache # Only restore cache (skip prerequisite checks)
 *   pnpm run setup --quiet        # Minimal output (for postinstall)
 *
 * Flags:
 *   --install       Auto-install missing optional tools (gh CLI)
 *   --restore-cache Only restore cache, skip prerequisite checks
 *   --quiet         Minimal output
 *
 * Note: Setup helpers are also exported in build-infra/lib/setup-helpers
 * for reuse in other build scripts.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawn } from '@socketsecurity/lib/spawn'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const logger = getDefaultLogger()

const autoInstall = process.argv.includes('--install')
const quiet = process.argv.includes('--quiet')
const restoreCacheOnly = process.argv.includes('--restore-cache')

// Use synchronous console for clean output.
const log = {
  error: (msg) => console.log(colors.red(`✗ ${msg}`)),
  info: (msg) => !quiet && console.log(colors.blue(`ℹ ${msg}`)),
  step: (msg) => !quiet && console.log(colors.cyan(`→ ${msg}`)),
  success: (msg) => !quiet && console.log(colors.green(`✔ ${msg}`)),
  warn: (msg) => console.log(colors.yellow(`⚠ ${msg}`)),
}

/**
 * Check if a command is available.
 */
async function hasCommand(command) {
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
 * Get version of a command.
 */
async function getVersion(command, args = ['--version']) {
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
 * Parse version string to compare.
 */
function parseVersion(versionString) {
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
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * Install Homebrew (macOS/Linux).
 */
async function installHomebrew() {
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
 */
async function installChocolatey() {
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
 * Install a package using Homebrew (macOS/Linux).
 */
async function installWithHomebrew(packageName) {
  if (!await hasCommand('brew')) {
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
 * Install a package using Chocolatey (Windows).
 */
async function installWithChocolatey(packageName) {
  if (!await hasCommand('choco')) {
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
 * Check and optionally install gh CLI.
 */
async function ensureGhCli() {
  if (await hasCommand('gh')) {
    const version = await getVersion('gh')
    log.success(`gh CLI ${version} (optional)`)
    return true
  }

  if (!autoInstall) {
    log.info('gh CLI not found (optional - enables cache restoration)')
    log.info('Install from: https://cli.github.com/')
    log.info('Or run: pnpm run setup --install')
    return false
  }

  // Auto-install mode.
  if (WIN32) {
    // Windows: Try Chocolatey.
    if (!await hasCommand('choco')) {
      log.info('Chocolatey not found (needed for auto-install on Windows)')
      log.step('Attempting to install Chocolatey...')
      const installed = await installChocolatey()
      if (!installed) {
        log.warn('Could not install Chocolatey')
        log.info('Install gh CLI manually from: https://cli.github.com/')
        log.info('Or install Chocolatey from: https://chocolatey.org/install')
        return false
      }
    }

    // Install gh CLI with Chocolatey.
    log.step('Installing gh CLI with Chocolatey...')
    const installed = await installWithChocolatey('gh')
    if (installed) {
      // Verify gh is actually available after installation.
      if (await hasCommand('gh')) {
        const version = await getVersion('gh')
        log.success(`gh CLI ${version} installed!`)
        return true
      }
      log.warn('gh CLI installed but not available in PATH')
      log.info('You may need to restart your shell or run: pnpm run setup')
      return false
    }

    log.warn('Could not install gh CLI')
    log.info('Install manually from: https://cli.github.com/')
    return false
  }

  // macOS/Linux: Try Homebrew.
  if (!await hasCommand('brew')) {
    log.info('Homebrew not found (needed for auto-install)')
    log.step('Attempting to install Homebrew...')
    const installed = await installHomebrew()
    if (!installed) {
      log.warn('Could not install Homebrew')
      log.info('Install gh CLI manually from: https://cli.github.com/')
      return false
    }
  }

  // Install gh CLI with Homebrew.
  log.step('Installing gh CLI with Homebrew...')
  const installed = await installWithHomebrew('gh')
  if (installed) {
    // Verify gh is actually available after installation.
    if (await hasCommand('gh')) {
      const version = await getVersion('gh')
      log.success(`gh CLI ${version} installed!`)
      return true
    }
    log.warn('gh CLI installed but not available in PATH')
    log.info('You may need to restart your shell or run: pnpm run setup')
    return false
  }

  log.warn('Could not install gh CLI')
  log.info('Install manually from: https://cli.github.com/')
  return false
}

/**
 * Check prerequisite.
 */
async function checkPrerequisite({ command, minVersion, name, required = true }) {
  const version = await getVersion(command)

  if (!version) {
    log.error(`${name} not found`)
    return false
  }

  if (minVersion) {
    const current = parseVersion(version)
    if (!current) {
      log.warn(`Could not parse ${name} version: ${version}`)
      return !required
    }

    if (compareVersions(current, minVersion) < 0) {
      const minVersionStr = `${minVersion.major}.${minVersion.minor}.${minVersion.patch}`
      log.error(`${name} ${version} found, but >=${minVersionStr} required`)
      return false
    }
  }

  log.success(`${name} ${version}`)
  return true
}

/**
 * Restore build cache if possible.
 */
async function restoreCache(hasGh) {
  // Skip entirely if gh CLI not available.
  if (!hasGh) {
    log.info('Skipping cache restoration (gh CLI not available)')
    return false
  }

  // Check if already built.
  if (existsSync('packages/cli/build') && existsSync('packages/cli/dist')) {
    log.info('Build artifacts already exist, skipping cache restoration')
    return true
  }

  // Ensure directories exist.
  log.step('Ensuring build directories exist...')
  await mkdir('packages/cli/build', { recursive: true })
  await mkdir('packages/cli/dist', { recursive: true })

  log.step('Attempting to restore build cache from CI...')

  const result = await spawn(
    'pnpm',
    ['--filter', '@socketsecurity/cli', 'run', 'restore-cache', '--quiet'],
    {
      stdio: 'inherit',
    }
  )

  if (result.code === 0) {
    log.success('Build cache restored!')
    return true
  }

  log.info('Cache not available for this commit (will build from scratch)')
  return false
}

/**
 * Main entry point.
 */
async function main() {
  // Handle --restore-cache: only restore cache, skip prerequisite checks.
  if (restoreCacheOnly) {
    if (!quiet) {
      console.log('')
      console.log('Socket CLI Cache Restoration')
      console.log('============================')
      console.log('')
    }

    const hasGh = await hasCommand('gh')
    if (!hasGh) {
      log.error('gh CLI not found (required for cache restoration)')
      log.info('Install from: https://cli.github.com/')
      log.info('Or run: pnpm run setup --install')
      return 1
    }

    await restoreCache(hasGh)

    if (!quiet) {
      console.log('')
      log.success('Cache restoration complete!')
      console.log('')
    }
    return 0
  }

  // Normal setup flow: check prerequisites and restore cache.
  if (!quiet) {
    console.log('')
    console.log('Socket CLI Developer Setup')
    console.log('==========================')
    console.log('')

    if (autoInstall) {
      log.info('Auto-install mode enabled (--install)')
      console.log('')
    }
  }

  log.step('Checking prerequisites...')
  if (!quiet) {
    console.log('')
  }

  // Check Node.js.
  const nodeOk = await checkPrerequisite({
    command: 'node',
    minVersion: { major: 18, minor: 0, patch: 0 },
    name: 'Node.js',
    required: true,
  })

  // Check pnpm.
  const pnpmOk = await checkPrerequisite({
    command: 'pnpm',
    minVersion: { major: 10, minor: 21, patch: 0 },
    name: 'pnpm',
    required: true,
  })

  // Check gh CLI (optional, with auto-install).
  const ghOk = await ensureGhCli()

  if (!quiet) {
    console.log('')
  }

  if (!nodeOk || !pnpmOk) {
    log.error('Required prerequisites missing. Please install and try again.')
    if (!quiet) {
      console.log('')
    }
    if (!nodeOk) {
      log.info('Node.js: https://nodejs.org/')
    }
    if (!pnpmOk) {
      log.info('pnpm: npm install -g pnpm')
    }
    return 1
  }

  log.success('All required prerequisites met!')
  if (!quiet) {
    console.log('')
  }

  // Always restore cache after prerequisite checks.
  await restoreCache(ghOk)

  if (!quiet) {
    console.log('')
    log.success('Setup complete!')
    console.log('')
    console.log('Next steps:')
    console.log('  pnpm run build    # Build the CLI')
    console.log('  pnpm test:unit    # Run tests')
    console.log('  pnpm exec socket  # Run the CLI')
    console.log('')
  }

  return 0
}

main().then(code => {
  process.exit(code)
}).catch(error => {
  log.error(error.message)
  process.exit(1)
})
