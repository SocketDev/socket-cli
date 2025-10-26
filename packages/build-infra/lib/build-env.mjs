/**
 * Build Environment Detection and Setup
 *
 * Provides utilities for detecting and activating build toolchains:
 * - Emscripten SDK detection and activation
 * - Rust toolchain verification
 * - Python version checking
 * - CI environment detection
 * - Auto-setup and error recovery
 *
 * Used by all builder packages for consistent environment handling.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform as osPlatform } from 'node:os'
import path from 'node:path'

/**
 * Detect if running in CI environment.
 */
export function isCI() {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS
  )
}

/**
 * Detect if running in Docker.
 */
export function isDocker() {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv')
}

/**
 * Get platform identifier.
 */
export function getPlatform() {
  return osPlatform()
}

/**
 * Check if command exists.
 */
export function commandExists(cmd) {
  try {
    const checkCmd =
      getPlatform() === 'win32' ? `where ${cmd} 2>nul` : `which ${cmd} 2>/dev/null`
    execSync(checkCmd, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Get command output.
 */
export function getCommandOutput(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return ''
  }
}

/**
 * Find Emscripten SDK installation.
 *
 * Searches common locations and returns path if found.
 * Returns object with { path, type } where type is 'emsdk' or 'homebrew'.
 */
export function findEmscriptenSDK() {
  // Check if EMSDK environment variable is already set.
  if (process.env.EMSDK && existsSync(process.env.EMSDK)) {
    return { path: process.env.EMSDK, type: 'emsdk' }
  }

  // Try to find EMSDK path from emcc location if it's in PATH.
  if (commandExists('emcc')) {
    try {
      let emccPath = getCommandOutput(
        getPlatform() === 'win32' ? 'where emcc' : 'which emcc'
      )

      if (emccPath) {
        // Resolve symlinks to get the real path.
        // Homebrew emcc is typically a symlink.
        const platform = getPlatform()
        if (platform !== 'win32' && existsSync(emccPath)) {
          try {
            const realPath = getCommandOutput(`readlink -f "${emccPath}" 2>/dev/null || readlink "${emccPath}"`)
            if (realPath) {
              emccPath = realPath
            }
          } catch {
            // If readlink fails, continue with original path.
          }
        }

        // Check if this is a Homebrew installation.
        // Homebrew: /opt/homebrew/Cellar/emscripten/VERSION/bin/emcc
        // Standard: EMSDK/upstream/emscripten/emcc
        if (emccPath.includes('/Cellar/emscripten/')) {
          // Homebrew installation - extract the Cellar path.
          const match = emccPath.match(/(.*\/Cellar\/emscripten\/[^/]+)/)
          if (match) {
            const homebrewPath = match[1]
            // Verify Emscripten.cmake exists.
            const cmakeFile = path.join(
              homebrewPath,
              'libexec/cmake/Modules/Platform/Emscripten.cmake'
            )
            if (existsSync(cmakeFile)) {
              return { path: homebrewPath, type: 'homebrew' }
            }
          }
        }

        // Try standard EMSDK structure.
        // emcc is typically at EMSDK/upstream/emscripten/emcc
        // Navigate up: emcc -> emscripten -> upstream -> EMSDK
        const emscriptenDir = path.dirname(emccPath)
        const upstreamDir = path.dirname(emscriptenDir)
        const emsdkPath = path.dirname(upstreamDir)

        const emsdkScript = path.join(
          emsdkPath,
          getPlatform() === 'win32' ? 'emsdk.bat' : 'emsdk'
        )

        if (existsSync(emsdkScript)) {
          return { path: emsdkPath, type: 'emsdk' }
        }
      }
    } catch {
      // Can't determine EMSDK path from emcc location.
    }
  }

  // Search common installation locations.
  const searchPaths = [
    path.join(homedir(), '.emsdk'),
    path.join(homedir(), 'emsdk'),
    '/opt/emsdk',
    '/usr/local/emsdk',
    'C:\\emsdk',
  ]

  for (const emsdkPath of searchPaths) {
    const emsdkScript = path.join(
      emsdkPath,
      getPlatform() === 'win32' ? 'emsdk.bat' : 'emsdk'
    )

    if (existsSync(emsdkScript)) {
      return { path: emsdkPath, type: 'emsdk' }
    }
  }

  return null
}

/**
 * Activate Emscripten SDK.
 *
 * Sets environment variables for current process to use Emscripten.
 * Returns true if successful, false otherwise.
 */
export function activateEmscriptenSDK() {
  const emsdkInfo = findEmscriptenSDK()

  if (!emsdkInfo) {
    return false
  }

  const { path: emsdkPath, type } = emsdkInfo

  try {
    // For Homebrew installations, just set EMSDK environment variable.
    // emcc is already in PATH, no need to source scripts.
    if (type === 'homebrew') {
      process.env.EMSDK = emsdkPath
      process.env.EMSCRIPTEN = path.join(emsdkPath, 'libexec')
      return commandExists('emcc')
    }

    // For standard EMSDK installations, source the environment script.
    const platform = getPlatform()

    if (platform === 'win32') {
      // On Windows, run emsdk_env.bat and capture environment.
      const envScript = path.join(emsdkPath, 'emsdk_env.bat')
      if (!existsSync(envScript)) {
        return false
      }

      // Run emsdk_env.bat and capture resulting environment.
      const envOutput = execSync(
        `cmd /c "${envScript} && set"`,
        { encoding: 'utf8', stdio: 'pipe' }
      )

      // Parse environment variables.
      const envLines = envOutput.split('\n')
      for (const line of envLines) {
        const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
        if (match) {
          process.env[match[1]] = match[2].trim()
        }
      }
    } else {
      // On Unix, source emsdk_env.sh and capture environment.
      const envScript = path.join(emsdkPath, 'emsdk_env.sh')
      if (!existsSync(envScript)) {
        return false
      }

      // Run bash to source script and print environment.
      const envOutput = execSync(
        `bash -c "source ${envScript} > /dev/null 2>&1 && env"`,
        { encoding: 'utf8', stdio: 'pipe' }
      )

      // Parse environment variables.
      const envLines = envOutput.split('\n')
      for (const line of envLines) {
        const match = line.match(/^(EMSDK|EM_\w+|PATH)=(.*)$/)
        if (match) {
          process.env[match[1]] = match[2].trim()
        }
      }
    }

    // Verify emcc is now available and EMSDK is set.
    return commandExists('emcc') && !!process.env.EMSDK
  } catch (error) {
    console.error(`Failed to activate Emscripten: ${error.message}`)
    return false
  }
}

/**
 * Get Emscripten version.
 */
export function getEmscriptenVersion() {
  if (!commandExists('emcc')) {
    return null
  }

  try {
    const version = getCommandOutput('emcc --version')
    const match = version.match(/emcc.*?(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Check if Rust is available with WASM support.
 */
export function checkRust() {
  if (!commandExists('rustc')) {
    return { available: false, reason: 'rustc not found' }
  }

  const version = getCommandOutput('rustc --version')
  const match = version.match(/rustc (\d+\.\d+\.\d+)/)

  if (!match) {
    return { available: false, reason: 'version detection failed' }
  }

  // Check for WASM target.
  const targets = getCommandOutput('rustup target list --installed')
  if (!targets.includes('wasm32-unknown-unknown')) {
    return {
      available: false,
      reason: 'wasm32-unknown-unknown target not installed',
      fix: 'rustup target add wasm32-unknown-unknown',
    }
  }

  // Check for wasm-pack.
  if (!commandExists('wasm-pack')) {
    return {
      available: false,
      reason: 'wasm-pack not found',
      fix: 'cargo install wasm-pack',
    }
  }

  return { available: true, version: match[1] }
}

/**
 * Check Python version.
 */
export function checkPython() {
  const pythonCmds = ['python3', 'python']

  for (const cmd of pythonCmds) {
    if (commandExists(cmd)) {
      const version = getCommandOutput(`${cmd} --version`)
      const match = version.match(/Python (\d+)\.(\d+)\.(\d+)/)

      if (match) {
        const major = parseInt(match[1])
        const minor = parseInt(match[2])
        const patch = parseInt(match[3])

        return {
          available: true,
          version: `${major}.${minor}.${patch}`,
          command: cmd,
          meetsRequirement: major >= 3 && minor >= 8,
        }
      }
    }
  }

  return { available: false }
}

/**
 * Setup build environment for current package.
 *
 * Activates necessary toolchains and verifies prerequisites.
 * Returns object with status and any error messages.
 *
 * @param {Object} options - Setup options
 * @param {boolean} options.emscripten - Require Emscripten SDK
 * @param {boolean} options.rust - Require Rust with WASM support
 * @param {boolean} options.python - Require Python 3.8+
 * @param {boolean} options.autoSetup - Automatically run setup script if tools missing
 * @returns {Object} Setup result with status and messages
 */
export async function setupBuildEnvironment(options = {}) {
  const {
    emscripten = false,
    rust = false,
    python = false,
    autoSetup = true,
  } = options

  const results = {
    success: true,
    messages: [],
    errors: [],
  }

  // Check Emscripten.
  if (emscripten) {
    const activated = activateEmscriptenSDK()

    if (activated) {
      const version = getEmscriptenVersion()
      results.messages.push(`✓ Emscripten ${version} activated`)
    } else {
      results.success = false
      results.errors.push('✗ Emscripten SDK not found')

      if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mjs --emscripten'
        )
      } else {
        results.errors.push(
          '  Install from: https://emscripten.org/docs/getting_started/downloads.html'
        )
      }
    }
  }

  // Check Rust.
  if (rust) {
    const rustCheck = checkRust()

    if (rustCheck.available) {
      results.messages.push(`✓ Rust ${rustCheck.version} with WASM support`)
    } else {
      results.success = false
      results.errors.push(`✗ Rust: ${rustCheck.reason}`)

      if (rustCheck.fix) {
        results.errors.push(`  Fix: ${rustCheck.fix}`)
      } else if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mjs --rust'
        )
      }
    }
  }

  // Check Python.
  if (python) {
    const pythonCheck = checkPython()

    if (pythonCheck.available) {
      if (pythonCheck.meetsRequirement) {
        results.messages.push(`✓ Python ${pythonCheck.version}`)
      } else {
        results.success = false
        results.errors.push(
          `✗ Python ${pythonCheck.version} is too old (need 3.8+)`
        )

        if (autoSetup) {
          results.errors.push(
            '  Run: node scripts/setup-build-toolchain.mjs --python'
          )
        }
      }
    } else {
      results.success = false
      results.errors.push('✗ Python 3.8+ not found')

      if (autoSetup) {
        results.errors.push(
          '  Run: node scripts/setup-build-toolchain.mjs --python'
        )
      }
    }
  }

  return results
}

/**
 * Print environment setup results.
 */
export function printSetupResults(results) {
  if (results.messages.length > 0) {
    console.log('\nBuild Environment:')
    for (const message of results.messages) {
      console.log(`  ${message}`)
    }
  }

  if (results.errors.length > 0) {
    console.error('\nMissing Prerequisites:')
    for (const error of results.errors) {
      console.error(`  ${error}`)
    }
  }

  if (!results.success) {
    console.error('\n❌ Build environment setup failed')
    console.error('   Run setup script to install missing tools\n')
  }
}
