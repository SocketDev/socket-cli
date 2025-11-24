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
 *   pnpm run setup                      # Check prerequisites and restore GitHub cache
 *   pnpm run setup --install            # Check and auto-install optional tools, then restore cache
 *   pnpm run setup --skip-prereqs       # Only restore GitHub cache (skip prerequisite checks)
 *   pnpm run setup --skip-gh-cache      # Check prerequisites but skip GitHub cache restoration
 *   pnpm run setup --quiet              # Minimal output (for postinstall)
 *
 * Flags:
 *   --install            Auto-install missing optional tools (gh CLI)
 *   --skip-prereqs       Skip prerequisite checks (for CI use; still attempts cache restoration)
 *   --skip-gh-cache      Skip GitHub cache restoration (useful when cache is corrupt)
 *   --quiet              Minimal output
 *
 * Note: Setup helpers are also exported in build-infra/lib/setup-helpers
 * for reuse in other build scripts.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const autoInstall = process.argv.includes('--install')
const quiet = process.argv.includes('--quiet')
const skipPrereqs = process.argv.includes('--skip-prereqs')
const skipGhCache = process.argv.includes('--skip-gh-cache')

// Handle --help flag.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  logger.log(`
Socket CLI Developer Setup

Usage:
  pnpm run setup [options]

Options:
  --install          Auto-install missing optional tools (gh CLI)
  --skip-prereqs     Skip prerequisite checks (for CI use)
  --skip-gh-cache    Skip GitHub cache restoration (useful when cache is corrupt)
  --quiet            Minimal output
  --help, -h         Show this help message

Examples:
  pnpm run setup                      # Check prerequisites and restore cache
  pnpm run setup --install            # Auto-install optional tools
  pnpm run setup --skip-gh-cache      # Skip cache (useful if cache is corrupt)
  pnpm run setup --skip-prereqs       # Skip checks, only restore cache
`)
  process.exit(0)
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
  if (!match) {return null}
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
  if (a.major !== b.major) {return a.major < b.major ? -1 : 1}
  if (a.minor !== b.minor) {return a.minor < b.minor ? -1 : 1}
  if (a.patch !== b.patch) {return a.patch < b.patch ? -1 : 1}
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
 * Install Chocolatey (Windows).
 */
async function installChocolatey() {
  if (!WIN32) {
    logger.warn('Chocolatey is only available on Windows')
    return false
  }

  logger.step('Installing Chocolatey...')
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
 * Install a package using Homebrew (macOS/Linux).
 */
async function installWithHomebrew(packageName) {
  if (!(await hasCommand('brew'))) {
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
  if (!(await hasCommand('choco'))) {
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
      logger.log('Attempting to install Chocolatey...')
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
    logger.log('Installing gh CLI with Chocolatey...')
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
    logger.log('Attempting to install Homebrew...')
    const installed = await installHomebrew()
    if (!installed) {
      logger.warn('Could not install Homebrew')
      logger.info('Install gh CLI manually from: https://cli.github.com/')
      return false
    }
  }

  // Install gh CLI with Homebrew.
  logger.log('Installing gh CLI with Homebrew...')
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

/**
 * Check prerequisite.
 */
async function checkPrerequisite({
  command,
  minVersion,
  name,
  required = true,
}) {
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

/**
 * Restore build cache if possible.
 */
async function restoreCache(hasGh) {
  // Skip entirely if gh CLI not available.
  if (!hasGh) {
    logger.info('Skipping cache restoration (gh CLI not available)')
    return false
  }

  // Check if already built.
  if (existsSync('packages/cli/build') && existsSync('packages/cli/dist')) {
    logger.info('Build artifacts already exist, skipping cache restoration')
    return true
  }

  // Ensure directories exist.
  logger.log('Ensuring build directories exist...')
  await mkdir('packages/cli/build', { recursive: true })
  await mkdir('packages/cli/dist', { recursive: true })

  logger.log('Attempting to restore build cache from CI...')

  const result = await spawn(
    'pnpm',
    ['--filter', '@socketsecurity/cli', 'run', 'restore-cache', '--quiet'],
    {
      stdio: 'inherit',
    },
  )

  if (result.code === 0) {
    logger.log('Build cache restored!')
    return true
  }

  logger.info('Cache not available for this commit (will build from scratch)')
  return false
}

/**
 * Main entry point.
 */
async function main() {
  // Handle --skip-prereqs: skip prerequisite checks, proceed to cache restoration.
  if (skipPrereqs) {
    if (!quiet) {
      logger.log('')
      logger.log('Socket CLI Cache Restoration')
      logger.log('============================')
      logger.log('')
      logger.info('Skipping prerequisite checks (--skip-prereqs)')
      logger.log('')
    }

    // Cache restoration respects --skip-gh-cache flag.
    if (!skipGhCache) {
      const hasGh = await hasCommand('gh')
      if (!hasGh) {
        logger.error('gh CLI not found (required for cache restoration)')
        logger.info('Install from: https://cli.github.com/')
        return 1
      }
      await restoreCache(hasGh)
    } else if (!quiet) {
      logger.info('Skipping GitHub cache restoration (--skip-gh-cache)')
    }

    if (!quiet) {
      logger.log('')
      logger.log('Setup complete!')
      logger.log('')
    }
    return 0
  }

  // Normal setup flow: check prerequisites and restore cache.
  if (!quiet) {
    logger.log('')
    logger.log('Socket CLI Developer Setup')
    logger.log('==========================')
    logger.log('')

    if (autoInstall) {
      logger.info('Auto-install mode enabled (--install)')
      logger.log('')
    }
  }

  logger.log('Checking prerequisites...')
  if (!quiet) {
    logger.log('')
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
    logger.log('')
  }

  if (!nodeOk || !pnpmOk) {
    logger.error(
      'Required prerequisites missing. Please install and try again.',
    )
    if (!quiet) {
      logger.log('')
    }
    if (!nodeOk) {
      logger.info('Node.js: https://nodejs.org/')
    }
    if (!pnpmOk) {
      logger.info('pnpm: npm install -g pnpm')
    }
    return 1
  }

  logger.log('All required prerequisites met!')
  if (!quiet) {
    logger.log('')
  }

  // Always restore cache after prerequisite checks (unless --skip-gh-cache).
  if (!skipGhCache) {
    await restoreCache(ghOk)
  } else if (!quiet) {
    logger.info('Skipping GitHub cache restoration (--skip-gh-cache)')
  }

  if (!quiet) {
    logger.log('')
    logger.log('Setup complete!')
    logger.log('')
    logger.log('Next steps:')
    logger.log('  pnpm run build    # Build the CLI')
    logger.log('  pnpm test         # Run tests')
    logger.log('  pnpm exec socket  # Run the CLI')
    logger.log('')
  }

  return 0
}

main()
  .then(code => {
    process.exit(code)
  })
  .catch(error => {
    logger.error(error.message)
    process.exit(1)
  })
