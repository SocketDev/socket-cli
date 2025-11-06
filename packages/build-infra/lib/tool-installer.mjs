/**
 * Tool Installation Utilities
 *
 * Provides utilities for automatically installing missing build tools
 * using platform-specific package managers (brew, apt, choco, etc.).
 */

import binPkg from '@socketsecurity/lib-external/bin'
import platformPkg from '@socketsecurity/lib-external/constants/platform'
import spawnPkg from '@socketsecurity/lib-external/spawn'

const { whichBinSync } = binPkg
const { WIN32 } = platformPkg
const { spawn } = spawnPkg

import { printError, printStep, printSubstep, printWarning } from './build-output.mjs'

/**
 * Tool installation configurations.
 */
const TOOL_CONFIGS = {
  __proto__: null,
  git: {
    description: 'Git version control system',
    packages: {
      darwin: { brew: 'git' },
      linux: { apt: 'git', yum: 'git', dnf: 'git', apk: 'git' },
      win32: { choco: 'git', scoop: 'git' },
    },
  },
  curl: {
    description: 'Command-line tool for transferring data',
    packages: {
      darwin: { brew: 'curl' },
      linux: { apt: 'curl', yum: 'curl', dnf: 'curl', apk: 'curl' },
      win32: { choco: 'curl', scoop: 'curl' },
    },
  },
  patch: {
    description: 'GNU patch utility for applying diffs',
    packages: {
      darwin: { brew: 'gpatch' },
      linux: { apt: 'patch', yum: 'patch', dnf: 'patch', apk: 'patch' },
      win32: { choco: 'patch', scoop: 'patch' },
    },
  },
  make: {
    description: 'GNU Make build tool',
    packages: {
      darwin: { brew: 'make' },
      linux: { apt: 'make', yum: 'make', dnf: 'make', apk: 'make' },
      win32: { choco: 'make', scoop: 'make' },
    },
  },
  python3: {
    description: 'Python 3 interpreter',
    packages: {
      darwin: { brew: 'python3' },
      linux: { apt: 'python3', yum: 'python3', dnf: 'python3', apk: 'python3' },
      win32: { choco: 'python', scoop: 'python' },
    },
  },
}

/**
 * Package manager configuration per platform.
 */
const PACKAGE_MANAGER_CONFIGS = {
  __proto__: null,
  darwin: {
    preferred: 'brew',
    available: ['brew'],
    brew: {
      name: 'Homebrew',
      binary: 'brew',
      installScript: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      checkCommand: 'brew --version',
      description: 'macOS package manager',
    },
  },
  linux: {
    preferred: 'apt',
    available: ['apt', 'apk', 'dnf', 'yum'],
    apt: {
      name: 'APT',
      binary: 'apt-get',
      installScript: null, // Pre-installed on Debian/Ubuntu.
      checkCommand: 'apt-get --version',
      description: 'Debian/Ubuntu package manager',
    },
    apk: {
      name: 'APK',
      binary: 'apk',
      installScript: null, // Pre-installed on Alpine Linux.
      checkCommand: 'apk --version',
      description: 'Alpine Linux package manager',
    },
    dnf: {
      name: 'DNF',
      binary: 'dnf',
      installScript: null, // Pre-installed on Fedora 22+/RHEL 8+.
      checkCommand: 'dnf --version',
      description: 'Fedora/RHEL 8+ package manager',
    },
    yum: {
      name: 'YUM',
      binary: 'yum',
      installScript: null, // Pre-installed on older RHEL/CentOS.
      checkCommand: 'yum --version',
      description: 'RHEL/CentOS package manager',
    },
  },
  win32: {
    preferred: 'choco',
    available: ['choco', 'scoop'],
    choco: {
      name: 'Chocolatey',
      binary: 'choco',
      installScript: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString(\'https://chocolatey.org/install.ps1\'))"',
      checkCommand: 'choco --version',
      description: 'Windows package manager',
    },
    scoop: {
      name: 'Scoop',
      binary: 'scoop',
      installScript: 'powershell -Command "iex (new-object net.webclient).downloadstring(\'https://get.scoop.sh\')"',
      checkCommand: 'scoop --version',
      description: 'Windows command-line installer',
    },
  },
}

/**
 * Detect available package managers on the system.
 *
 * @returns {string[]} Array of available package manager names.
 */
export function detectPackageManagers() {
  const platform = process.platform
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  if (!config) {
    return []
  }

  const managers = []

  for (const managerName of config.available) {
    const managerConfig = config[managerName]
    if (whichBinSync(managerConfig.binary, { nothrow: true })) {
      managers.push(managerName)
    }
  }

  return managers
}

/**
 * Get preferred package manager for current platform.
 *
 * @returns {string|null} Preferred package manager name or null.
 */
export function getPreferredPackageManager() {
  const platform = process.platform
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  return config ? config.preferred : null
}

/**
 * Install a package manager.
 *
 * @param {string} managerName - Package manager to install.
 * @param {object} options - Installation options.
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installPackageManager(managerName, { autoYes = false } = {}) {
  const platform = process.platform
  const platformConfig = PACKAGE_MANAGER_CONFIGS[platform]

  if (!platformConfig) {
    printError(`Unsupported platform: ${platform}`)
    return false
  }

  const managerConfig = platformConfig[managerName]
  if (!managerConfig) {
    printError(`Unknown package manager: ${managerName}`)
    return false
  }

  // Check if already installed.
  if (whichBinSync(managerConfig.binary, { nothrow: true })) {
    printSubstep(`${managerConfig.name} is already installed`)
    return true
  }

  // Check if installation script is available.
  if (!managerConfig.installScript) {
    printError(`${managerConfig.name} must be pre-installed on this system`)
    return false
  }

  printStep(`Installing ${managerConfig.name}...`)
  printWarning('This will execute an installation script from the package manager\'s official source')

  // For non-auto-yes mode, prompt user.
  if (!autoYes) {
    printSubstep(`Run: ${managerConfig.installScript}`)
    printWarning('Please run the above command manually with appropriate permissions')
    return false
  }

  try {
    const result = await spawn('sh', ['-c', managerConfig.installScript], {
      env: process.env,
      shell: WIN32,
      stdio: 'inherit',
    })

    const exitCode = result.code ?? 0
    if (exitCode !== 0) {
      printError(`Failed to install ${managerConfig.name}`)
      return false
    }

    // Verify installation.
    const installed = whichBinSync(managerConfig.binary, { nothrow: true })
    if (installed) {
      printSubstep(`✅ ${managerConfig.name} installed successfully`)
      return true
    }

    printWarning(`${managerConfig.name} installation completed but binary not found`)
    return false
  } catch (e) {
    printError(`Error installing ${managerConfig.name}`, e)
    return false
  }
}

/**
 * Ensure a package manager is available, installing if needed.
 *
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default: false).
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 * @returns {Promise<{available: boolean, manager: string|null, installed: boolean}>}
 */
export async function ensurePackageManagerAvailable({ autoInstall = false, autoYes = false } = {}) {
  // Check if any package manager is already available.
  const managers = detectPackageManagers()
  if (managers.length > 0) {
    return {
      available: true,
      installed: false,
      manager: managers[0],
    }
  }

  if (!autoInstall) {
    return {
      available: false,
      installed: false,
      manager: null,
    }
  }

  // Attempt to install preferred package manager.
  const preferred = getPreferredPackageManager()
  if (!preferred) {
    return {
      available: false,
      installed: false,
      manager: null,
    }
  }

  printStep(`No package manager detected, attempting to install ${preferred}`)
  const installed = await installPackageManager(preferred, { autoYes })

  return {
    available: installed,
    installed,
    manager: installed ? preferred : null,
  }
}

/**
 * Get package manager installation instructions.
 *
 * @returns {string[]} Array of installation instruction strings.
 */
export function getPackageManagerInstructions() {
  const platform = process.platform
  const config = PACKAGE_MANAGER_CONFIGS[platform]

  if (!config) {
    return ['Unsupported platform for package manager auto-installation']
  }

  const instructions = []
  const preferred = config[config.preferred]

  instructions.push(`Install ${preferred.name} (${preferred.description}):`)
  if (preferred.installScript) {
    instructions.push('  ' + preferred.installScript)
  } else {
    instructions.push('  (Pre-installed on this system)')
  }

  return instructions
}

/**
 * Check if running with elevated privileges (sudo/admin).
 *
 * @returns {Promise<boolean>}
 */
export async function checkElevatedPrivileges() {
  const platform = process.platform

  if (platform === 'win32') {
    // On Windows, check if running as administrator.
    try {
      const result = await execCapture(
        'net session 2>nul'
      )
      return result.code === 0
    } catch {
      return false
    }
  }

  // On Unix, check if root user or has sudo access.
  if (process.getuid && process.getuid() === 0) {
    return true
  }

  // Check if sudo is available.
  try {
    const result = await execCapture('sudo -n true 2>/dev/null')
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Install a tool using the specified package manager.
 *
 * @param {string} tool - Tool name.
 * @param {string} packageManager - Package manager to use.
 * @param {object} options - Installation options.
 * @param {boolean} options.autoYes - Automatically answer yes to prompts.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installTool(tool, packageManager, { autoYes = false } = {}) {
  const config = TOOL_CONFIGS[tool]
  if (!config) {
    printError(`Unknown tool: ${tool}`)
    return false
  }

  const platform = process.platform
  const packageInfo = config.packages[platform]

  if (!packageInfo || !packageInfo[packageManager]) {
    printError(`No ${packageManager} package available for ${tool} on ${platform}`)
    return false
  }

  const packageName = packageInfo[packageManager]
  printSubstep(`Installing ${tool} via ${packageManager}...`)

  try {
    let command
    let args
    const needsSudo = platform !== 'win32' && ['apt', 'apk', 'yum', 'dnf'].includes(packageManager)

    switch (packageManager) {
      case 'brew':
        command = 'brew'
        args = ['install', packageName]
        break

      case 'apt':
        command = needsSudo ? 'sudo' : 'apt-get'
        args = needsSudo
          ? ['apt-get', 'install', '-y', packageName]
          : ['install', '-y', packageName]
        break

      case 'apk':
        command = needsSudo ? 'sudo' : 'apk'
        args = needsSudo
          ? ['apk', 'add', '--no-cache', packageName]
          : ['add', '--no-cache', packageName]
        break

      case 'yum':
        command = needsSudo ? 'sudo' : 'yum'
        args = needsSudo
          ? ['yum', 'install', '-y', packageName]
          : ['install', '-y', packageName]
        break

      case 'dnf':
        command = needsSudo ? 'sudo' : 'dnf'
        args = needsSudo
          ? ['dnf', 'install', '-y', packageName]
          : ['install', '-y', packageName]
        break

      case 'choco':
        command = 'choco'
        args = autoYes
          ? ['install', packageName, '-y']
          : ['install', packageName]
        break

      case 'scoop':
        command = 'scoop'
        args = ['install', packageName]
        break

      default:
        printError(`Unsupported package manager: ${packageManager}`)
        return false
    }

    const result = await spawn(command, args, {
      env: process.env,
      shell: WIN32,
      stdio: 'inherit',
    })

    const exitCode = result.code ?? 0
    if (exitCode !== 0) {
      printError(`Failed to install ${tool} via ${packageManager}`)
      return false
    }

    // Verify installation.
    const installed = whichBinSync(tool, { nothrow: true })
    if (installed) {
      printSubstep(`✅ ${tool} installed successfully`)
      return true
    }

    printWarning(`${tool} installation completed but binary not found in PATH`)
    return false
  } catch (e) {
    printError(`Error installing ${tool}`, e)
    return false
  }
}

/**
 * Ensure a tool is installed, attempting auto-installation if needed.
 *
 * @param {string} tool - Tool name to check/install.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation if missing (default: true).
 * @param {boolean} options.autoYes - Automatically answer yes to prompts (default: false).
 * @returns {Promise<{available: boolean, installed: boolean, packageManager: string|null}>}
 */
export async function ensureToolInstalled(
  tool,
  { autoInstall = true, autoYes = false } = {}
) {
  // Check if already installed.
  const binPath = whichBinSync(tool, { nothrow: true })
  if (binPath) {
    return { available: true, installed: false, packageManager: null }
  }

  if (!autoInstall) {
    return { available: false, installed: false, packageManager: null }
  }

  // Detect available package managers.
  const managers = detectPackageManagers()
  if (!managers.length) {
    printWarning(
      `No package manager detected for auto-installing ${tool}`
    )
    return { available: false, installed: false, packageManager: null }
  }

  // Try to install using the first available package manager.
  const packageManager = managers[0]
  printStep(`Attempting to install ${tool} using ${packageManager}`)

  const installed = await installTool(tool, packageManager, { autoYes })

  return {
    available: installed,
    installed,
    packageManager: installed ? packageManager : null,
  }
}

/**
 * Get installation instructions for a tool.
 *
 * @param {string} tool - Tool name.
 * @returns {string[]} Array of installation instruction strings.
 */
export function getInstallInstructions(tool) {
  const config = TOOL_CONFIGS[tool]
  if (!config) {
    return [`Unknown tool: ${tool}`]
  }

  const platform = process.platform
  const instructions = []

  instructions.push(`Install ${tool} (${config.description}):`)

  if (platform === 'darwin') {
    instructions.push('  brew install ' + config.packages.darwin.brew)
  } else if (platform === 'linux') {
    const pkg = config.packages.linux
    if (pkg.apt) {
      instructions.push('  sudo apt-get install -y ' + pkg.apt)
    }
    if (pkg.apk) {
      instructions.push('  sudo apk add --no-cache ' + pkg.apk)
    }
    if (pkg.yum) {
      instructions.push('  sudo yum install -y ' + pkg.yum)
    }
    if (pkg.dnf) {
      instructions.push('  sudo dnf install -y ' + pkg.dnf)
    }
  } else if (platform === 'win32') {
    const pkg = config.packages.win32
    if (pkg.choco) {
      instructions.push('  choco install ' + pkg.choco)
    }
    if (pkg.scoop) {
      instructions.push('  scoop install ' + pkg.scoop)
    }
  }

  return instructions
}

/**
 * Ensure all required tools are installed.
 *
 * @param {string[]} tools - Array of tool names to check.
 * @param {object} options - Options.
 * @param {boolean} options.autoInstall - Attempt auto-installation (default: true).
 * @param {boolean} options.autoYes - Auto-yes to prompts (default: false).
 * @returns {Promise<{allAvailable: boolean, missing: string[], installed: string[]}>}
 */
export async function ensureAllToolsInstalled(
  tools,
  { autoInstall = true, autoYes = false } = {}
) {
  const missing = []
  const installed = []

  for (const tool of tools) {
    const result = await ensureToolInstalled(tool, { autoInstall, autoYes })

    if (!result.available) {
      missing.push(tool)
    } else if (result.installed) {
      installed.push(tool)
    }
  }

  return {
    allAvailable: missing.length === 0,
    installed,
    missing,
  }
}
