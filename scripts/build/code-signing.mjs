/**
 * @fileoverview Centralized code-signing utilities for Socket CLI binaries
 *
 * This module handles all code-signing operations for different platforms:
 * - macOS: codesign for ARM64 binaries (required for Apple Silicon)
 * - Windows: signtool for authenticode signing (optional, for trusted binaries)
 * - Linux: No native signing, but supports GPG signatures for verification
 *
 * Code signing is crucial for:
 * - macOS ARM64: Required by the OS, binaries won't run without signature
 * - Windows: Prevents "Unknown Publisher" warnings
 * - All platforms: Ensures binary integrity and authenticity
 */

import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { platform, arch } from 'node:os'

/**
 * Configuration for code signing behavior
 */
export const SIGNING_CONFIG = {
  // Enable/disable signing for each platform
  macos: {
    enabled: true,
    required: arch() === 'arm64', // Required for ARM64, optional for x64
    tool: 'codesign',
    fallbackTool: 'ldid', // Alternative for CI/cross-compilation
  },
  windows: {
    enabled: false, // Disabled by default, requires certificate
    required: false,
    tool: 'signtool',
    certificatePath: process.env.WINDOWS_CERT_PATH,
    certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
  },
  linux: {
    enabled: false, // GPG signing optional
    required: false,
    tool: 'gpg',
  }
}

/**
 * Check if a signing tool is available
 * @param {string} tool - Tool name (codesign, ldid, signtool, gpg)
 * @returns {boolean} True if tool is available
 */
export function isSigningToolAvailable(tool) {
  try {
    execSync(`which ${tool}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Sign a macOS binary
 *
 * @param {string} binaryPath - Path to the binary to sign
 * @param {Object} options - Signing options
 * @param {boolean} options.force - Force re-signing even if already signed
 * @param {boolean} options.quiet - Suppress output
 * @param {string} options.identity - Signing identity (default: '-' for ad-hoc)
 * @returns {Promise<{success: boolean, tool: string, message?: string}>}
 *
 * @example
 * // Ad-hoc signing (no certificate required)
 * await signMacOSBinary('/path/to/binary')
 *
 * @example
 * // Sign with developer certificate
 * await signMacOSBinary('/path/to/binary', {
 *   identity: 'Developer ID Application: Your Name (TEAMID)'
 * })
 */
export async function signMacOSBinary(binaryPath, options = {}) {
  const { force = false, quiet = false, identity = '-' } = options

  if (!existsSync(binaryPath)) {
    throw new Error(`Binary not found: ${binaryPath}`)
  }

  // Check if already signed
  if (!force) {
    const isSigned = await isMacOSBinarySigned(binaryPath)
    if (isSigned) {
      return { success: true, tool: 'already-signed', message: 'Binary is already signed' }
    }
  }

  // Try codesign first (native macOS tool)
  if (isSigningToolAvailable('codesign')) {
    try {
      await runCommand('codesign', ['--sign', identity, '--force', binaryPath], { quiet })
      return { success: true, tool: 'codesign' }
    } catch (error) {
      if (!quiet) {
        console.warn(`codesign failed: ${error.message}`)
      }
    }
  }

  // Fallback to ldid (cross-platform alternative)
  if (isSigningToolAvailable('ldid')) {
    try {
      // Remove existing signature first
      await runCommand('codesign', ['--remove-signature', binaryPath], { quiet: true }).catch(() => {})
      // Sign with ldid
      await runCommand('ldid', ['-S', binaryPath], { quiet })
      return { success: true, tool: 'ldid' }
    } catch (error) {
      if (!quiet) {
        console.warn(`ldid failed: ${error.message}`)
      }
    }
  }

  // No signing tools available
  const message = arch() === 'arm64'
    ? 'CRITICAL: No signing tool available for ARM64 binary. Binary will not run!'
    : 'Warning: No signing tool available. Binary may require user approval.'

  return { success: false, tool: 'none', message }
}

/**
 * Check if a macOS binary is signed
 *
 * @param {string} binaryPath - Path to the binary
 * @returns {Promise<boolean>} True if binary is signed
 */
export async function isMacOSBinarySigned(binaryPath) {
  if (!isSigningToolAvailable('codesign')) {
    return false
  }

  try {
    await runCommand('codesign', ['-dv', binaryPath], { quiet: true })
    return true
  } catch {
    return false
  }
}

/**
 * Sign a Windows binary with Authenticode
 *
 * @param {string} binaryPath - Path to the binary
 * @param {Object} options - Signing options
 * @param {string} options.certificatePath - Path to .pfx certificate
 * @param {string} options.certificatePassword - Certificate password
 * @param {string} options.description - Binary description
 * @param {string} options.url - Product URL
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<{success: boolean, message?: string}>}
 *
 * @example
 * await signWindowsBinary('/path/to/binary.exe', {
 *   certificatePath: '/path/to/cert.pfx',
 *   certificatePassword: 'password',
 *   description: 'Socket CLI',
 *   url: 'https://socket.dev'
 * })
 */
export async function signWindowsBinary(binaryPath, options = {}) {
  const {
    certificatePath = SIGNING_CONFIG.windows.certificatePath,
    certificatePassword = SIGNING_CONFIG.windows.certificatePassword,
    description = 'Socket CLI',
    url = 'https://socket.dev',
    quiet = false
  } = options

  if (!certificatePath || !certificatePassword) {
    return {
      success: false,
      message: 'Windows signing requires certificate path and password'
    }
  }

  if (!isSigningToolAvailable('signtool')) {
    return {
      success: false,
      message: 'signtool not available. Install Windows SDK.'
    }
  }

  try {
    const args = [
      'sign',
      '/f', certificatePath,
      '/p', certificatePassword,
      '/d', description,
      '/du', url,
      '/tr', 'http://timestamp.digicert.com',
      '/td', 'SHA256',
      '/fd', 'SHA256',
      binaryPath
    ]

    await runCommand('signtool', args, { quiet })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      message: `Windows signing failed: ${error.message}`
    }
  }
}

/**
 * Create a GPG signature for Linux binary
 *
 * @param {string} binaryPath - Path to the binary
 * @param {Object} options - Signing options
 * @param {string} options.keyId - GPG key ID
 * @param {boolean} options.armor - Create ASCII-armored signature
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<{success: boolean, signaturePath?: string, message?: string}>}
 *
 * @example
 * await signLinuxBinary('/path/to/binary', {
 *   keyId: 'YOUR_GPG_KEY_ID',
 *   armor: true
 * })
 * // Creates /path/to/binary.asc (or .sig if armor=false)
 */
export async function signLinuxBinary(binaryPath, options = {}) {
  const { keyId, armor = true, quiet = false } = options

  if (!isSigningToolAvailable('gpg')) {
    return {
      success: false,
      message: 'gpg not available. Install GnuPG.'
    }
  }

  try {
    const signaturePath = `${binaryPath}.${armor ? 'asc' : 'sig'}`
    const args = ['--detach-sign']

    if (armor) args.push('--armor')
    if (keyId) args.push('--local-user', keyId)
    args.push('--output', signaturePath, binaryPath)

    await runCommand('gpg', args, { quiet })
    return { success: true, signaturePath }
  } catch (error) {
    return {
      success: false,
      message: `GPG signing failed: ${error.message}`
    }
  }
}

/**
 * Automatically sign binary based on platform
 *
 * @param {string} binaryPath - Path to the binary
 * @param {Object} options - Platform-specific options
 * @returns {Promise<{success: boolean, platform: string, tool?: string, message?: string}>}
 *
 * @example
 * // Auto-detect platform and sign accordingly
 * const result = await signBinary('/path/to/binary')
 * if (!result.success && result.platform === 'darwin' && arch === 'arm64') {
 *   throw new Error('Failed to sign ARM64 binary - it will not run!')
 * }
 */
export async function signBinary(binaryPath, options = {}) {
  const currentPlatform = platform()

  switch (currentPlatform) {
    case 'darwin':
      if (!SIGNING_CONFIG.macos.enabled) {
        return { success: true, platform: 'darwin', message: 'macOS signing disabled' }
      }
      const macResult = await signMacOSBinary(binaryPath, options)
      return { ...macResult, platform: 'darwin' }

    case 'win32':
      if (!SIGNING_CONFIG.windows.enabled) {
        return { success: true, platform: 'win32', message: 'Windows signing disabled' }
      }
      const winResult = await signWindowsBinary(binaryPath, options)
      return { ...winResult, platform: 'win32' }

    case 'linux':
      if (!SIGNING_CONFIG.linux.enabled) {
        return { success: true, platform: 'linux', message: 'Linux signing disabled' }
      }
      const linuxResult = await signLinuxBinary(binaryPath, options)
      return { ...linuxResult, platform: 'linux' }

    default:
      return {
        success: false,
        platform: currentPlatform,
        message: `Unsupported platform: ${currentPlatform}`
      }
  }
}

/**
 * Helper to run commands
 * @private
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.quiet ? 'pipe' : 'inherit',
      ...options
    })

    let stdout = ''
    let stderr = ''

    if (options.quiet) {
      child.stdout?.on('data', data => { stdout += data })
      child.stderr?.on('data', data => { stderr += data })
    }

    child.on('exit', code => {
      if (code === 0) {
        resolve({ code, stdout, stderr })
      } else {
        const error = new Error(`${command} exited with code ${code}`)
        error.code = code
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })

    child.on('error', reject)
  })
}

/**
 * Install ldid for cross-platform macOS signing
 * Useful for CI environments that need to sign macOS binaries
 *
 * @param {boolean} quiet - Suppress output
 * @returns {Promise<boolean>} True if installation successful
 */
export async function installLdid(quiet = false) {
  if (isSigningToolAvailable('ldid')) {
    return true
  }

  try {
    if (!quiet) console.log('Installing ldid for macOS signing...')

    // Try to install via package manager
    if (platform() === 'darwin') {
      // macOS: use Homebrew
      await runCommand('brew', ['install', 'ldid'], { quiet })
    } else if (platform() === 'linux') {
      // Linux: try apt first, then build from source
      try {
        await runCommand('apt-get', ['update'], { quiet })
        await runCommand('apt-get', ['install', '-y', 'ldid'], { quiet })
      } catch {
        // Build from source as fallback
        if (!quiet) console.log('Building ldid from source...')
        await runCommand('git', ['clone', 'https://github.com/xerub/ldid.git', '/tmp/ldid'], { quiet })
        await runCommand('make', [], { cwd: '/tmp/ldid', quiet })
        await runCommand('cp', ['/tmp/ldid/ldid', '/usr/local/bin/'], { quiet })
      }
    }

    return isSigningToolAvailable('ldid')
  } catch (error) {
    if (!quiet) console.error(`Failed to install ldid: ${error.message}`)
    return false
  }
}

// Export all functions and config
export default {
  SIGNING_CONFIG,
  isSigningToolAvailable,
  signMacOSBinary,
  isMacOSBinarySigned,
  signWindowsBinary,
  signLinuxBinary,
  signBinary,
  installLdid
}