/**
 * @fileoverview Helper functions for build script
 *
 * Extracted helpers for better organization and testability.
 */

import { promises as fs, statfsSync } from 'node:fs'
import { join } from 'node:path'

import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

/**
 * Execute and capture output.
 */
export async function execCapture(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  const result = await spawn(command, args, {
    cwd,
    env,
    stdio: 'pipe',
    shell: false,
  })

  const stdout = result.stdout ? result.stdout.trim() : ''
  const stderr = result.stderr ? result.stderr.trim() : ''

  return {
    code: result.code,
    stdout,
    stderr,
  }
}

/**
 * Check available disk space.
 */
export async function checkDiskSpace(path) {
  try {
    const stats = statfsSync(path)
    const availableBytes = stats.bavail * stats.bsize
    const availableGB = availableBytes / 1024 ** 3
    return {
      availableGB: Math.floor(availableGB),
      availableBytes,
      sufficient: availableGB >= 5, // Need 5GB for build.
    }
  } catch (e) {
    // If we can't check, assume it's fine (don't block builds).
    return {
      availableGB: null,
      availableBytes: null,
      sufficient: true,
      error: e.message,
    }
  }
}

/**
 * Verify downloaded file integrity.
 */
export async function verifyFileIntegrity(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')

    // Check file is not empty.
    if (content.length === 0) {
      return { valid: false, reason: 'File is empty' }
    }

    // Check file is not an HTML error page.
    if (content.includes('<html>') || content.includes('<!DOCTYPE')) {
      return {
        valid: false,
        reason: 'File contains HTML (probably error page)',
      }
    }

    // For patch files, check they start with diff markers.
    if (filePath.endsWith('.patch')) {
      if (
        !content.includes('diff ') &&
        !content.includes('---') &&
        !content.includes('+++')
      ) {
        return { valid: false, reason: 'Patch file missing diff markers' }
      }
    }

    return { valid: true }
  } catch (e) {
    return { valid: false, reason: e.message }
  }
}

/**
 * Check Python version.
 */
export async function checkPythonVersion() {
  try {
    // Try python3 first.
    const result = await execCapture('python3', ['--version'])
    if (result.code === 0 && result.stdout) {
      const match = result.stdout.match(/Python (\d+)\.(\d+)/)
      if (match) {
        const major = Number.parseInt(match[1], 10)
        const minor = Number.parseInt(match[2], 10)
        return {
          available: true,
          version: `${major}.${minor}`,
          major,
          minor,
          sufficient: major === 3 && minor >= 6,
        }
      }
    }
  } catch {
    // Try python.
    try {
      const result = await execCapture('python', ['--version'])
      if (result.code === 0) {
        // Python 2 prints to stderr, Python 3 to stdout.
        const output = result.stdout || result.stderr
        const match = output.match(/Python (\d+)\.(\d+)/)
        if (match) {
          const major = Number.parseInt(match[1], 10)
          const minor = Number.parseInt(match[2], 10)
          return {
            available: true,
            version: `${major}.${minor}`,
            major,
            minor,
            sufficient: major === 3 && minor >= 6,
          }
        }
      }
    } catch {
      // Fall through.
    }
  }

  return {
    available: false,
    version: null,
    major: null,
    minor: null,
    sufficient: false,
  }
}

/**
 * Check if C++ compiler available.
 */
export async function checkCompiler() {
  // Try different compilers.
  const compilers = [
    { name: 'clang++', cmd: 'clang++', args: ['--version'] },
    { name: 'g++', cmd: 'g++', args: ['--version'] },
    { name: 'c++', cmd: 'c++', args: ['--version'] },
  ]

  for (const { args, cmd, name } of compilers) {
    try {
      const result = await execCapture(cmd, args)
      if (result.code === 0) {
        return { available: true, compiler: name }
      }
    } catch {
      // Try next compiler.
    }
  }

  return { available: false, compiler: null }
}

/**
 * Check if ccache is available and install if needed.
 */
export async function checkCcache() {
  const ccachePaths = [
    '/opt/homebrew/bin/ccache',
    '/usr/local/bin/ccache',
    '/usr/bin/ccache',
  ]

  // Check if ccache is already installed.
  for (const ccachePath of ccachePaths) {
    try {
      const result = await execCapture(ccachePath, ['--version'])
      if (result.code === 0) {
        return { available: true, path: ccachePath, installed: false }
      }
    } catch {
      // Try next path.
    }
  }

  // Check if brew is available for installation.
  try {
    const brewCheck = await execCapture('brew', ['--version'])
    if (brewCheck.code !== 0) {
      return {
        available: false,
        canInstall: false,
        path: null,
        reason: 'Homebrew not found',
      }
    }
  } catch {
    return {
      available: false,
      canInstall: false,
      path: null,
      reason: 'Homebrew not found',
    }
  }

  // Install ccache via brew.
  return {
    available: false,
    canInstall: true,
    path: null,
    reason: 'Not installed but can be installed via brew',
  }
}

/**
 * Install ccache via Homebrew.
 */
export async function installCcache() {
  try {
    const result = await execCapture('brew', ['install', 'ccache'])
    if (result.code === 0) {
      // Find the installed ccache path.
      const paths = ['/opt/homebrew/bin/ccache', '/usr/local/bin/ccache']
      for (const ccachePath of paths) {
        try {
          const checkResult = await execCapture(ccachePath, ['--version'])
          if (checkResult.code === 0) {
            return { success: true, path: ccachePath }
          }
        } catch {
          // Try next path.
        }
      }
      return { success: false, error: 'Installed but ccache not found in PATH' }
    }
    return { success: false, error: result.stderr || 'Installation failed' }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * Get build log path.
 */
export function getBuildLogPath(buildDir) {
  return join(buildDir, 'build.log')
}

/**
 * Save build output to log file.
 */
export async function saveBuildLog(buildDir, content) {
  const logPath = getBuildLogPath(buildDir)
  try {
    await fs.appendFile(logPath, `${content}\n`)
  } catch {
    // Don't fail build if logging fails.
  }
}

/**
 * Get last N lines from build log.
 */
export async function getLastLogLines(buildDir, lines = 50) {
  const logPath = getBuildLogPath(buildDir)
  try {
    const content = await fs.readFile(logPath, 'utf8')
    const allLines = content.split('\n')
    return allLines.slice(-lines).join('\n')
  } catch {
    return null
  }
}

/**
 * Format duration in human-readable form.
 */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Create checkpoint for build resume.
 */
export async function createCheckpoint(buildDir, step) {
  const checkpointFile = join(buildDir, '.build-checkpoint')
  try {
    await fs.writeFile(
      checkpointFile,
      JSON.stringify({
        step,
        timestamp: Date.now(),
      }),
    )
  } catch {
    // Don't fail if checkpoint creation fails.
  }
}

/**
 * Read checkpoint.
 */
export async function readCheckpoint(buildDir) {
  const checkpointFile = join(buildDir, '.build-checkpoint')
  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Clean checkpoint.
 */
export async function cleanCheckpoint(buildDir) {
  const checkpointFile = join(buildDir, '.build-checkpoint')
  try {
    await fs.unlink(checkpointFile)
  } catch {
    // Ignore errors.
  }
}

/**
 * Estimate build time based on CPU cores.
 */
export function estimateBuildTime(cpuCount) {
  // Rough estimates based on testing.
  // 10 cores: ~30 min
  // 8 cores: ~40 min
  // 4 cores: ~60 min
  // 2 cores: ~90 min

  const baseTime = 300 // 300 seconds for 10 cores.
  const adjustedTime = (baseTime * 10) / cpuCount
  const minutes = Math.round(adjustedTime / 60)

  return {
    estimatedMinutes: minutes,
    minMinutes: Math.floor(minutes * 0.8),
    maxMinutes: Math.ceil(minutes * 1.2),
  }
}

/**
 * Check network connectivity.
 */
export async function checkNetworkConnectivity() {
  try {
    // Try to reach GitHub (where we clone from).
    const result = await execCapture('curl', [
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '--connect-timeout',
      '5',
      'https://github.com',
    ])

    const statusCode = result.stdout
    return {
      connected:
        statusCode === '200' || statusCode === '301' || statusCode === '302',
      statusCode,
    }
  } catch {
    return { connected: false, statusCode: null }
  }
}

/**
 * Verify git tag exists.
 */
export async function verifyGitTag(version) {
  try {
    const result = await execCapture('git', [
      'ls-remote',
      '--tags',
      'https://github.com/nodejs/node.git',
      version,
    ])

    return {
      exists: result.stdout.includes(version),
      output: result.stdout,
    }
  } catch {
    return { exists: false, output: null }
  }
}

/**
 * Test if binary is functional (quick smoke test).
 */
export async function smokeTestBinary(binaryPath, env = {}) {
  try {
    // Test 1: Version check.
    const versionResult = await execCapture(binaryPath, ['--version'], { env })
    if (versionResult.code !== 0 || !versionResult.stdout.startsWith('v')) {
      return { passed: false, reason: 'Version check failed' }
    }

    // Test 2: Execute simple JS.
    const jsResult = await execCapture(
      binaryPath,
      ['-e', 'getDefaultLogger().log("OK")'],
      { env },
    )
    if (jsResult.code !== 0 || jsResult.stdout !== 'OK') {
      return { passed: false, reason: 'JS execution failed' }
    }

    return { passed: true }
  } catch (e) {
    return { passed: false, reason: e.message }
  }
}

/**
 * Pretty print file size.
 */
export function prettyBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)}${units[unitIndex]}`
}

/**
 * Check if Homebrew is installed (macOS).
 */
export async function hasHomebrew() {
  try {
    const result = await execCapture('which', ['brew'])
    return result.code === 0 && result.stdout.includes('brew')
  } catch {
    return false
  }
}

/**
 * Install Homebrew on macOS.
 *
 * @param {Object} exec - The exec function to use for running commands.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installHomebrew(exec) {
  getDefaultLogger().log('📥 Homebrew not found, installing Homebrew...')
  getDefaultLogger().log('This will take a few minutes and may prompt for password...')
  getDefaultLogger().log('')

  try {
    // Install Homebrew using official installation script.
    await exec(
      '/bin/bash',
      [
        '-c',
        '$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)',
      ],
      { stdio: 'inherit' },
    )
    getDefaultLogger().log(`${colors.green('✓')} Homebrew installed successfully`)
    getDefaultLogger().log('')
    return true
  } catch (e) {
    getDefaultLogger().error(`${colors.red('✗')} Homebrew installation failed: ${e.message}`)
    getDefaultLogger().error('Install manually: https://brew.sh')
    getDefaultLogger().error()
    return false
  }
}

/**
 * Install a Homebrew package.
 *
 * @param {string} packageName - The package to install.
 * @param {Object} exec - The exec function to use for running commands.
 * @returns {Promise<boolean>} True if installation succeeded.
 */
export async function installBrewPackage(packageName, exec) {
  getDefaultLogger().log(`📦 Installing ${packageName} via Homebrew...`)
  getDefaultLogger().log('This will take 1-2 minutes...')
  getDefaultLogger().log('')

  try {
    await exec('brew', ['install', packageName], { stdio: 'inherit' })
    getDefaultLogger().log(`${colors.green('✓')} ${packageName} installed successfully`)
    getDefaultLogger().log('')
    return true
  } catch (e) {
    getDefaultLogger().error(`${colors.red('✗')} ${packageName} installation failed: ${e.message}`)
    getDefaultLogger().error(`Try manually: brew install ${packageName}`)
    getDefaultLogger().error()
    return false
  }
}
