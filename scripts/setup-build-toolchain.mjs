#!/usr/bin/env node
/**
 * Automatic Build Toolchain Setup Script
 *
 * Detects and installs missing build prerequisites:
 * - Emscripten SDK (for WASM compilation)
 * - Rust + wasm-pack (for Rust WASM)
 * - Python 3.8+ (for Node.js compilation)
 * - C++ compiler (platform-specific)
 * - CMake, Ninja (for native builds)
 *
 * Supports:
 * - macOS (Homebrew)
 * - Linux (apt-get, yum)
 * - Windows (Chocolatey, winget)
 * - GitHub Actions (pre-installed tools)
 * - Docker (minimal installs)
 *
 * Usage:
 *   node scripts/setup-build-toolchain.mjs              # Check and install all
 *   node scripts/setup-build-toolchain.mjs --check-only # Only check, don't install
 *   node scripts/setup-build-toolchain.mjs --emscripten # Install only Emscripten
 *   node scripts/setup-build-toolchain.mjs --rust       # Install only Rust
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, platform as osPlatform, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const CHECK_ONLY = args.includes('--check-only')
const INSTALL_EMSCRIPTEN = args.includes('--emscripten') || !args.some(a => a.startsWith('--'))
const INSTALL_RUST = args.includes('--rust') || !args.some(a => a.startsWith('--'))
const INSTALL_PYTHON = args.includes('--python') || !args.some(a => a.startsWith('--'))
const INSTALL_COMPILER = args.includes('--compiler') || !args.some(a => a.startsWith('--'))
const FORCE_INSTALL = args.includes('--force')
const QUIET = args.includes('--quiet')

// Detect environment.
const IS_CI = !!(
  process.env.CI ||
  process.env.GITHUB_ACTIONS ||
  process.env.GITLAB_CI ||
  process.env.CIRCLECI
)
const IS_GITHUB_ACTIONS = !!process.env.GITHUB_ACTIONS
const IS_DOCKER = existsSync('/.dockerenv')
const PLATFORM = osPlatform()

/**
 * Log with color support.
 */
function log(message, color = '') {
  if (QUIET && !color.includes('red')) return

  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
  }

  const prefix = color ? colors[color] || '' : ''
  const suffix = color ? colors.reset : ''
  getDefaultLogger().log(`${prefix}${message}${suffix}`)
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green')
}

function logError(message) {
  log(`✗ ${message}`, 'red')
}

function logWarn(message) {
  log(`⚠ ${message}`, 'yellow')
}

function logInfo(message) {
  log(`ℹ ${message}`, 'blue')
}

/**
 * Execute command and return success boolean.
 */
function exec(command, options = {}) {
  try {
    execSync(command, {
      stdio: QUIET ? 'pipe' : 'inherit',
      encoding: 'utf8',
      ...options,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Check if command exists.
 */
function commandExists(cmd) {
  const checkCmd = PLATFORM === 'win32' ? `where ${cmd}` : `which ${cmd}`
  return exec(checkCmd, { stdio: 'pipe' })
}

/**
 * Get command output.
 */
function getOutput(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return ''
  }
}

/**
 * Check Emscripten SDK.
 */
function checkEmscripten() {
  logInfo('Checking Emscripten SDK...')

  // Check if emcc is available.
  if (commandExists('emcc')) {
    const version = getOutput('emcc --version')
    const match = version.match(/emcc.*?(\d+\.\d+\.\d+)/)
    if (match) {
      logSuccess(`Emscripten ${match[1]} found`)
      return { installed: true, version: match[1] }
    }
  }

  // Check common installation locations.
  const possiblePaths = [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    '/opt/emsdk',
    'C:\\emsdk',
  ]

  for (const emsdkPath of possiblePaths) {
    const emsdkEnv = path.join(
      emsdkPath,
      PLATFORM === 'win32' ? 'emsdk_env.bat' : 'emsdk_env.sh'
    )

    if (existsSync(emsdkEnv)) {
      logWarn(`Emscripten found at ${emsdkPath} but not activated`)
      logInfo(`Run: source ${emsdkEnv}`)
      return { installed: true, needsActivation: true, path: emsdkPath }
    }
  }

  logWarn('Emscripten SDK not found')
  return { installed: false }
}

/**
 * Install Emscripten SDK.
 */
async function installEmscripten() {
  if (CHECK_ONLY) {
    logInfo('Skipping Emscripten installation (check-only mode)')
    return false
  }

  logInfo('Installing Emscripten SDK...')

  const emsdkPath = path.join(homedir(), '.emsdk')
  const emsdkVersion = '3.1.70' // Pinned version for reproducibility.

  try {
    // Clone emsdk if not exists.
    if (!existsSync(emsdkPath)) {
      logInfo(`Cloning emsdk to ${emsdkPath}...`)
      if (
        !exec(
          `git clone https://github.com/emscripten-core/emsdk.git "${emsdkPath}"`
        )
      ) {
        logError('Failed to clone emsdk')
        return false
      }
    }

    // Install and activate specific version.
    const emsdkCmd = path.join(
      emsdkPath,
      PLATFORM === 'win32' ? 'emsdk.bat' : 'emsdk'
    )

    logInfo(`Installing Emscripten ${emsdkVersion}...`)
    if (!exec(`cd "${emsdkPath}" && "${emsdkCmd}" install ${emsdkVersion}`)) {
      logError('Failed to install Emscripten')
      return false
    }

    logInfo('Activating Emscripten...')
    if (!exec(`cd "${emsdkPath}" && "${emsdkCmd}" activate ${emsdkVersion}`)) {
      logError('Failed to activate Emscripten')
      return false
    }

    // Create activation helper script.
    const activateScript = path.join(emsdkPath, 'activate.sh')
    await writeFile(
      activateScript,
      `#!/bin/bash\nsource "${emsdkPath}/emsdk_env.sh"\n`,
      { mode: 0o755 }
    )

    logSuccess('Emscripten SDK installed successfully')
    logInfo(`Activate with: source ${emsdkPath}/emsdk_env.sh`)

    // Set environment for current process.
    if (PLATFORM !== 'win32') {
      const envScript = path.join(emsdkPath, 'emsdk_env.sh')
      if (existsSync(envScript)) {
        // Parse emsdk_env.sh and set environment variables.
        const envOutput = getOutput(`bash -c "source ${envScript} && env"`)
        const envLines = envOutput.split('\n')

        for (const line of envLines) {
          const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
          if (match) {
            process.env[match[1]] = match[2]
          }
        }

        logInfo('Emscripten environment activated for this session')
      }
    }

    return true
  } catch (error) {
    logError(`Failed to install Emscripten: ${error.message}`)
    return false
  }
}

/**
 * Check Rust toolchain.
 */
function checkRust() {
  logInfo('Checking Rust toolchain...')

  if (!commandExists('rustc')) {
    logWarn('Rust not found')
    return { installed: false }
  }

  const version = getOutput('rustc --version')
  const match = version.match(/rustc (\d+\.\d+\.\d+)/)

  if (!match) {
    logWarn('Rust version detection failed')
    return { installed: true, version: 'unknown' }
  }

  // Check for WASM target.
  const targets = getOutput('rustup target list --installed')
  const hasWasm = targets.includes('wasm32-unknown-unknown')

  if (!hasWasm) {
    logWarn('Rust WASM target not installed')
    return { installed: true, version: match[1], needsWasmTarget: true }
  }

  // Check for wasm-pack.
  if (!commandExists('wasm-pack')) {
    logWarn('wasm-pack not found')
    return {
      installed: true,
      version: match[1],
      needsWasmPack: true,
    }
  }

  logSuccess(`Rust ${match[1]} with WASM support found`)
  return { installed: true, version: match[1] }
}

/**
 * Install Rust toolchain.
 */
async function installRust() {
  if (CHECK_ONLY) {
    logInfo('Skipping Rust installation (check-only mode)')
    return false
  }

  logInfo('Installing Rust toolchain...')

  try {
    // Install rustup.
    if (!commandExists('rustc')) {
      if (PLATFORM === 'win32') {
        logInfo('Download Rust from: https://rustup.rs/')
        logError(
          'Automatic Rust installation not supported on Windows via script'
        )
        logInfo('Please install manually and run this script again')
        return false
      }

      logInfo('Installing Rust via rustup...')
      if (
        !exec(
          'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y'
        )
      ) {
        logError('Failed to install Rust')
        return false
      }

      // Add cargo to PATH for current session.
      const cargoPath = path.join(homedir(), '.cargo', 'bin')
      process.env.PATH = `${cargoPath}:${process.env.PATH}`
    }

    // Add WASM target.
    logInfo('Adding WASM target...')
    if (!exec('rustup target add wasm32-unknown-unknown')) {
      logError('Failed to add WASM target')
      return false
    }

    // Install wasm-pack.
    if (!commandExists('wasm-pack')) {
      logInfo('Installing wasm-pack...')

      if (PLATFORM === 'darwin' && commandExists('brew')) {
        exec('brew install wasm-pack')
      } else if (
        !exec(
          'curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh'
        )
      ) {
        logError('Failed to install wasm-pack')
        return false
      }
    }

    logSuccess('Rust toolchain installed successfully')
    return true
  } catch (error) {
    logError(`Failed to install Rust: ${error.message}`)
    return false
  }
}

/**
 * Check package manager.
 */
function checkPackageManager() {
  logInfo('Checking package manager...')

  if (PLATFORM === 'darwin') {
    if (commandExists('brew')) {
      const version = getOutput('brew --version')
      const match = version.match(/Homebrew (\d+\.\d+\.\d+)/)
      if (match) {
        logSuccess(`Homebrew ${match[1]} found`)
        return { installed: true, manager: 'brew', version: match[1] }
      }
      logSuccess('Homebrew found')
      return { installed: true, manager: 'brew' }
    }
    logWarn('Homebrew not found')
    return { installed: false, manager: 'brew', needsInstall: true }
  }

  if (PLATFORM === 'linux') {
    if (commandExists('apt-get')) {
      logSuccess('apt-get found')
      return { installed: true, manager: 'apt-get' }
    }
    if (commandExists('yum')) {
      logSuccess('yum found')
      return { installed: true, manager: 'yum' }
    }
    logWarn('No package manager found (apt-get or yum)')
    return { installed: false }
  }

  if (PLATFORM === 'win32') {
    if (commandExists('choco')) {
      const version = getOutput('choco --version')
      logSuccess(`Chocolatey ${version} found`)
      return { installed: true, manager: 'choco', version }
    }
    if (commandExists('winget')) {
      logSuccess('winget found')
      return { installed: true, manager: 'winget' }
    }
    logWarn('No package manager found (Chocolatey or winget)')
    return { installed: false, manager: 'choco', needsInstall: true }
  }

  return { installed: false }
}

/**
 * Install package manager.
 */
async function installPackageManager() {
  if (CHECK_ONLY) {
    logInfo('Skipping package manager installation (check-only mode)')
    return false
  }

  try {
    if (PLATFORM === 'darwin') {
      logInfo('Installing Homebrew...')
      logInfo('This will prompt for your password')
      log('')

      // Install Homebrew using official installation script.
      const installCmd = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

      if (!exec(installCmd)) {
        logError('Failed to install Homebrew')
        logInfo('Visit https://brew.sh/ for manual installation instructions')
        return false
      }

      // Add Homebrew to PATH for Apple Silicon Macs.
      if (process.arch === 'arm64') {
        const brewPath = '/opt/homebrew/bin'
        if (existsSync(brewPath)) {
          process.env.PATH = `${brewPath}:${process.env.PATH}`
        }
      }

      logSuccess('Homebrew installed successfully')
      return true
    }

    if (PLATFORM === 'win32') {
      logInfo('Installing Chocolatey...')
      logInfo('This requires administrator privileges')
      log('')

      // Install Chocolatey using official PowerShell script.
      const installCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://community.chocolatey.org/install.ps1\'))"'

      if (!exec(installCmd)) {
        logError('Failed to install Chocolatey')
        logInfo('Visit https://chocolatey.org/install for manual installation instructions')
        return false
      }

      // Refresh environment to pick up choco.
      exec('refreshenv', { stdio: 'pipe' })

      logSuccess('Chocolatey installed successfully')
      return true
    }

    if (PLATFORM === 'linux') {
      logError('Linux package managers (apt-get/yum) should be pre-installed')
      logInfo('Please install your distribution\'s package manager manually')
      return false
    }

    logError(`Unsupported platform: ${PLATFORM}`)
    return false
  } catch (error) {
    logError(`Failed to install package manager: ${error.message}`)
    return false
  }
}

/**
 * Check Python.
 */
function checkPython() {
  logInfo('Checking Python...')

  const pythonCommands = ['python3', 'python']

  for (const cmd of pythonCommands) {
    if (commandExists(cmd)) {
      const version = getOutput(`${cmd} --version`)
      const match = version.match(/Python (\d+)\.(\d+)\.(\d+)/)

      if (match) {
        const major = parseInt(match[1])
        const minor = parseInt(match[2])

        if (major >= 3 && minor >= 8) {
          logSuccess(`Python ${match[1]}.${match[2]}.${match[3]} found`)
          return { installed: true, version: `${major}.${minor}.${match[3]}` }
        }

        logWarn(`Python ${match[1]}.${match[2]} is too old (need 3.8+)`)
        return { installed: true, version: `${major}.${minor}`, tooOld: true }
      }
    }
  }

  logWarn('Python 3.8+ not found')
  return { installed: false }
}

/**
 * Install Python.
 */
async function installPython() {
  if (CHECK_ONLY) {
    logInfo('Skipping Python installation (check-only mode)')
    return false
  }

  logInfo('Installing Python 3.12...')

  try {
    if (PLATFORM === 'darwin') {
      if (!commandExists('brew')) {
        logError('Homebrew not found. Install from: https://brew.sh/')
        return false
      }

      return exec('brew install python@3.12')
    }

    if (PLATFORM === 'linux') {
      // Try apt-get first.
      if (commandExists('apt-get')) {
        return (
          exec('sudo apt-get update') &&
          exec('sudo apt-get install -y python3 python3-pip')
        )
      }

      // Try yum.
      if (commandExists('yum')) {
        return exec('sudo yum install -y python3 python3-pip')
      }

      logError('No supported package manager found')
      return false
    }

    if (PLATFORM === 'win32') {
      if (commandExists('choco')) {
        return exec('choco install -y python')
      }

      if (commandExists('winget')) {
        return exec('winget install Python.Python.3.12')
      }

      logError('No supported package manager found')
      logInfo('Install from: https://www.python.org/downloads/')
      return false
    }

    logError(`Unsupported platform: ${PLATFORM}`)
    return false
  } catch (error) {
    logError(`Failed to install Python: ${error.message}`)
    return false
  }
}

/**
 * Check Python ML dependencies.
 */
function checkPythonMLDeps() {
  logInfo('Checking Python ML dependencies...')

  const pythonCmd = commandExists('python3') ? 'python3' : 'python'

  if (!commandExists(pythonCmd)) {
    logWarn('Python not found')
    return { installed: false }
  }

  const requiredPackages = {
    transformers: 'transformers',
    optimum: 'optimum',
    onnx: 'onnx',
    onnxruntime: 'onnxruntime',
  }

  const missing = []
  const installed = []

  for (const [key, pkg] of Object.entries(requiredPackages)) {
    const checkCmd = `${pythonCmd} -c "import ${key}" 2>/dev/null`
    if (exec(checkCmd, { stdio: 'pipe' })) {
      installed.push(pkg)
    } else {
      missing.push(pkg)
    }
  }

  if (!missing.length) {
    logSuccess(`All ML dependencies installed: ${installed.join(', ')}`)
    return { installed: true, packages: installed }
  }

  logWarn(`Missing ML dependencies: ${missing.join(', ')}`)
  return { installed: false, missing, hasPartial: !!installed.length }
}

/**
 * Install Python ML dependencies.
 */
async function installPythonMLDeps() {
  if (CHECK_ONLY) {
    logInfo('Skipping Python ML dependencies installation (check-only mode)')
    return false
  }

  logInfo('Installing Python ML dependencies...')

  const pythonCmd = commandExists('python3') ? 'python3' : 'python'

  if (!commandExists(pythonCmd)) {
    logError('Python not found. Install Python first.')
    return false
  }

  try {
    // Check for pip.
    const pipCmd = commandExists('pip3') ? 'pip3' : 'pip'

    if (!commandExists(pipCmd)) {
      logError('pip not found. Install pip first.')
      return false
    }

    logInfo('Installing transformers...')
    if (!exec(`${pipCmd} install transformers`)) {
      logError('Failed to install transformers')
      return false
    }

    logInfo('Installing optimum with onnxruntime...')
    if (!exec(`${pipCmd} install "optimum[onnxruntime]"`)) {
      logError('Failed to install optimum[onnxruntime]')
      return false
    }

    logInfo('Installing onnx...')
    if (!exec(`${pipCmd} install onnx`)) {
      logError('Failed to install onnx')
      return false
    }

    logSuccess('Python ML dependencies installed successfully')
    return true
  } catch (error) {
    logError(`Failed to install Python ML dependencies: ${error.message}`)
    return false
  }
}

/**
 * Check C++ compiler.
 */
function checkCompiler() {
  logInfo('Checking C++ compiler...')

  const compilers = {
    darwin: ['clang', 'gcc'],
    linux: ['gcc', 'clang'],
    win32: ['cl', 'gcc'],
  }

  const platformCompilers = compilers[PLATFORM] || ['gcc', 'clang']

  for (const compiler of platformCompilers) {
    if (commandExists(compiler)) {
      const version = getOutput(`${compiler} --version`)
      const firstLine = version.split('\n')[0]
      logSuccess(`${compiler} found: ${firstLine}`)
      return { installed: true, compiler, version: firstLine }
    }
  }

  logWarn('No C++ compiler found')
  return { installed: false }
}

/**
 * Install C++ compiler.
 */
async function installCompiler() {
  if (CHECK_ONLY) {
    logInfo('Skipping compiler installation (check-only mode)')
    return false
  }

  logInfo('Installing C++ compiler...')

  try {
    if (PLATFORM === 'darwin') {
      logInfo('Installing Xcode Command Line Tools...')
      return exec('xcode-select --install')
    }

    if (PLATFORM === 'linux') {
      if (commandExists('apt-get')) {
        return (
          exec('sudo apt-get update') &&
          exec('sudo apt-get install -y build-essential')
        )
      }

      if (commandExists('yum')) {
        return exec('sudo yum groupinstall -y "Development Tools"')
      }

      logError('No supported package manager found')
      return false
    }

    if (PLATFORM === 'win32') {
      if (commandExists('choco')) {
        return (
          exec('choco install -y visualstudio2022buildtools') &&
          exec('choco install -y visualstudio2022-workload-vctools')
        )
      }

      logError('Chocolatey not found')
      logInfo(
        'Install Visual Studio Build Tools from: https://visualstudio.microsoft.com/downloads/'
      )
      return false
    }

    logError(`Unsupported platform: ${PLATFORM}`)
    return false
  } catch (error) {
    logError(`Failed to install compiler: ${error.message}`)
    return false
  }
}

/**
 * Check additional build tools.
 */
function checkBuildTools() {
  logInfo('Checking build tools...')

  const tools = {
    cmake: 'CMake',
    ninja: 'Ninja',
    mold: 'Mold Linker',
    make: 'Make',
    git: 'Git',
  }

  const results = {}

  for (const [cmd, name] of Object.entries(tools)) {
    if (commandExists(cmd)) {
      logSuccess(`${name} found`)
      results[cmd] = true
    } else {
      logWarn(`${name} not found`)
      results[cmd] = false
    }
  }

  return results
}

/**
 * Install build tools (ninja and mold).
 */
async function installBuildTools() {
  if (CHECK_ONLY) {
    logInfo('Skipping build tools installation (check-only mode)')
    return false
  }

  logInfo('Installing build tools (ninja, mold)...')

  try {
    if (PLATFORM === 'darwin') {
      if (!commandExists('brew')) {
        logError('Homebrew not found. Install from: https://brew.sh/')
        return false
      }

      // Install ninja.
      if (!commandExists('ninja')) {
        logInfo('Installing ninja...')
        if (!exec('brew install ninja')) {
          logWarn('Failed to install ninja via brew')
        }
      }

      // Install mold (not available on macOS via brew, use lld instead).
      if (!commandExists('mold') && !commandExists('ld64.lld')) {
        logInfo('Installing llvm (includes lld linker)...')
        if (!exec('brew install llvm')) {
          logWarn('Failed to install llvm via brew')
        }
      }

      return true
    }

    if (PLATFORM === 'linux') {
      // Try apt-get first.
      if (commandExists('apt-get')) {
        const packages = []
        if (!commandExists('ninja')) {
          packages.push('ninja-build')
        }
        if (!commandExists('mold')) {
          packages.push('mold')
        }

        if (packages.length) {
          logInfo(`Installing ${packages.join(', ')}...`)
          return (
            exec('sudo apt-get update') &&
            exec(`sudo apt-get install -y ${packages.join(' ')}`)
          )
        }
        return true
      }

      // Try yum.
      if (commandExists('yum')) {
        const packages = []
        if (!commandExists('ninja')) {
          packages.push('ninja-build')
        }
        // mold not available in default yum repos, user needs to build from source.

        if (packages.length) {
          logInfo(`Installing ${packages.join(', ')}...`)
          return exec(`sudo yum install -y ${packages.join(' ')}`)
        }
        return true
      }

      logError('No supported package manager found')
      return false
    }

    if (PLATFORM === 'win32') {
      if (commandExists('choco')) {
        if (!commandExists('ninja')) {
          logInfo('Installing ninja...')
          if (!exec('choco install -y ninja')) {
            logWarn('Failed to install ninja via choco')
          }
        }
        // mold not available on Windows, will use MSVC linker.
        return true
      }

      if (commandExists('winget')) {
        if (!commandExists('ninja')) {
          logInfo('Installing ninja...')
          if (!exec('winget install Ninja-build.ninja')) {
            logWarn('Failed to install ninja via winget')
          }
        }
        return true
      }

      logError('No supported package manager found')
      return false
    }

    logError(`Unsupported platform: ${PLATFORM}`)
    return false
  } catch (error) {
    logError(`Failed to install build tools: ${error.message}`)
    return false
  }
}

/**
 * Create environment activation script.
 */
async function createActivationScript() {
  const scriptPath = path.join(__dirname, '..', 'activate-build-env.sh')

  const emscriptenPath = path.join(homedir(), '.emsdk')
  const cargoPath = path.join(homedir(), '.cargo', 'bin')

  const scriptContent = `#!/bin/bash
# Socket CLI Build Environment Activation Script
# Auto-generated by setup-build-toolchain.mjs

# Activate Emscripten SDK
if [ -f "${emscriptenPath}/emsdk_env.sh" ]; then
  source "${emscriptenPath}/emsdk_env.sh"
  echo "✓ Emscripten activated"
fi

# Add Rust to PATH
if [ -d "${cargoPath}" ]; then
  export PATH="${cargoPath}:$PATH"
  echo "✓ Rust activated"
fi

# Verify tools
echo ""
echo "Build environment ready:"
command -v emcc >/dev/null && echo "  ✓ emcc: $(emcc --version | head -1)"
command -v rustc >/dev/null && echo "  ✓ rustc: $(rustc --version)"
command -v python3 >/dev/null && echo "  ✓ python3: $(python3 --version)"
command -v clang >/dev/null && echo "  ✓ clang: $(clang --version | head -1)"
echo ""
`

  await writeFile(scriptPath, scriptContent, { mode: 0o755 })
  logSuccess(`Activation script created: ${scriptPath}`)
}

/**
 * Main entry point.
 */
async function main() {
  log('\n⚡ Socket CLI Build Toolchain Setup')
  log('='.repeat(60))
  log('')

  logInfo(`Platform: ${PLATFORM}`)
  logInfo(`CI Environment: ${IS_CI ? 'Yes' : 'No'}`)
  if (IS_GITHUB_ACTIONS) logInfo('GitHub Actions detected')
  if (IS_DOCKER) logInfo('Docker environment detected')
  log('')

  // Check package manager FIRST - required for all subsequent installations.
  const packageManagerCheck = checkPackageManager()

  // Install package manager if missing and needed.
  if (packageManagerCheck.needsInstall && !CHECK_ONLY) {
    log('')
    const installed = await installPackageManager()
    if (!installed) {
      logError('Package manager installation failed')
      logInfo('Please install manually and run this script again')
      process.exit(1)
    }
    log('')
  }

  const checks = {
    packageManager: packageManagerCheck,
    emscripten: checkEmscripten(),
    rust: checkRust(),
    python: checkPython(),
    pythonMLDeps: checkPythonMLDeps(),
    compiler: checkCompiler(),
  }

  log('')
  log('Build Tools:')
  checkBuildTools()

  log('')
  log('='.repeat(60))

  // Determine what needs installation.
  const needsInstall = {
    emscripten:
      INSTALL_EMSCRIPTEN && (!checks.emscripten.installed || FORCE_INSTALL),
    rust: INSTALL_RUST && (!checks.rust.installed || FORCE_INSTALL),
    python: INSTALL_PYTHON && (!checks.python.installed || FORCE_INSTALL),
    compiler: INSTALL_COMPILER && (!checks.compiler.installed || FORCE_INSTALL),
  }

  const anyMissing = Object.values(needsInstall).some(Boolean)

  if (!anyMissing) {
    log('')
    logSuccess('All required tools are installed!')
    await createActivationScript()
    return
  }

  if (CHECK_ONLY) {
    log('')
    logWarn('Some tools are missing (check-only mode, not installing)')
    return
  }

  log('')
  log('Installing missing tools...')
  log('')

  // Install missing tools.
  if (needsInstall.emscripten) {
    await installEmscripten()
    log('')
  }

  if (needsInstall.rust) {
    await installRust()
    log('')
  }

  if (needsInstall.python) {
    await installPython()
    log('')
  }

  // Install Python ML dependencies if Python is available.
  if (checks.python.installed || needsInstall.python) {
    const mlDepsCheck = checkPythonMLDeps()
    if (!mlDepsCheck.installed) {
      await installPythonMLDeps()
      log('')
    }
  }

  if (needsInstall.compiler) {
    await installCompiler()
    log('')
  }

  // Install build tools (ninja, mold) after platform installers are ready.
  const buildToolsCheck = checkBuildTools()
  if (!buildToolsCheck.ninja || !buildToolsCheck.mold) {
    await installBuildTools()
    log('')
  }

  // Create activation script.
  await createActivationScript()

  log('')
  log('='.repeat(60))
  logSuccess('Setup complete!')
  log('')
  logInfo('Next steps:')
  log('  1. Activate environment: source ./activate-build-env.sh')
  log('  2. Run builds: node scripts/build-all-binaries.mjs')
  log('')
}

main().catch(error => {
  logError(`\nSetup failed: ${error.message}`)
  if (error.stack) {
    getDefaultLogger().error(error.stack)
  }
  process.exit(1)
})
