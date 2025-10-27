/**
 * Build Helper Utilities
 *
 * Provides utilities for checking prerequisites, validating environment,
 * and testing built binaries.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { exec, execCapture } from './build-exec.mjs'
import { printError, printStep, printWarning } from './build-output.mjs'

/**
 * Check available disk space.
 *
 * @param {string} dir - Directory to check
 * @param {number} requiredBytes - Required bytes
 * @returns {Promise<boolean>}
 */
export async function checkDiskSpace(dir, requiredBytes) {
  printStep('Checking disk space')

  try {
    const { stdout } = await execCapture(`df -k "${dir}"`)
    const lines = stdout.trim().split('\n')
    if (lines.length < 2) {
      printWarning('Could not determine disk space')
      return true
    }

    const stats = lines[1].split(/\s+/)
    const availableKB = Number.parseInt(stats[3], 10)
    const availableBytes = availableKB * 1024

    if (availableBytes < requiredBytes) {
      const requiredGB = (requiredBytes / (1024 * 1024 * 1024)).toFixed(2)
      const availableGB = (availableBytes / (1024 * 1024 * 1024)).toFixed(2)
      printError(
        `Insufficient disk space. Required: ${requiredGB} GB, Available: ${availableGB} GB`
      )
      return false
    }

    return true
  } catch {
    printWarning('Could not check disk space')
    return true
  }
}

/**
 * Check if compiler is available.
 *
 * @param {string} compiler - Compiler command (e.g., 'clang++', 'gcc')
 * @returns {Promise<boolean>}
 */
export async function checkCompiler(compiler) {
  printStep(`Checking for ${compiler}`)

  try {
    await execCapture(`which ${compiler}`)
    return true
  } catch {
    printError(`${compiler} not found. Please install ${compiler}.`)
    return false
  }
}

/**
 * Check Python version.
 *
 * @param {string} minVersion - Minimum required version (e.g., '3.8')
 * @returns {Promise<boolean>}
 */
export async function checkPythonVersion(minVersion) {
  printStep('Checking Python version')

  try {
    const { stdout } = await execCapture(
      'python3 -c "import sys; print(f\'{sys.version_info.major}.{sys.version_info.minor}\')"'
    )
    const version = stdout.trim()
    const [major, minor] = version.split('.').map(Number)
    const [minMajor, minMinor] = minVersion.split('.').map(Number)

    if (major < minMajor || (major === minMajor && minor < minMinor)) {
      printError(
        `Python ${minVersion}+ required, but found ${version}`
      )
      return false
    }

    return true
  } catch {
    printError('Python 3 not found. Please install Python 3.')
    return false
  }
}

/**
 * Estimate build time based on CPU cores.
 *
 * @param {number} baseMinutes - Base time in minutes (single core)
 * @param {number} cores - Number of CPU cores
 * @returns {number} Estimated minutes
 */
export function estimateBuildTime(baseMinutes, cores) {
  // Amdahl's law approximation: not all build steps parallelize perfectly.
  const parallelFraction = 0.8
  const serialFraction = 1 - parallelFraction

  return Math.ceil(
    baseMinutes * (serialFraction + parallelFraction / cores)
  )
}

/**
 * Format duration in human-readable format.
 *
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration
 */
export function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${seconds}s`
}

/**
 * Smoke test a binary by running it with args.
 *
 * @param {string} binaryPath - Path to binary
 * @param {string[]} args - Arguments to pass
 * @returns {Promise<boolean>}
 */
export async function smokeTestBinary(binaryPath, args = ['--version']) {
  printStep(`Smoke testing ${path.basename(binaryPath)}`)

  try {
    await fs.access(binaryPath)
    const { code } = await execCapture(`${binaryPath} ${args.join(' ')}`)

    if (code !== 0) {
      printError(`Binary failed smoke test: ${binaryPath}`)
      return false
    }

    return true
  } catch (e) {
    printError(`Binary smoke test failed: ${binaryPath}`, e)
    return false
  }
}

/**
 * Get file size in human-readable format.
 *
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Size string (e.g., '1.2 MB')
 */
export async function getFileSize(filePath) {
  const stats = await fs.stat(filePath)
  const bytes = stats.size

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Get build log path.
 *
 * @param {string} buildDir - Build directory
 * @returns {string} Log file path
 */
export function getBuildLogPath(buildDir) {
  return path.join(buildDir, 'build.log')
}

/**
 * Save build output to log file.
 *
 * @param {string} buildDir - Build directory
 * @param {string} content - Content to log
 * @returns {Promise<void>}
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
 *
 * @param {string} buildDir - Build directory
 * @param {number} lines - Number of lines to get
 * @returns {Promise<string|null>} Last lines or null
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
 * Create checkpoint for build resume.
 *
 * @param {string} buildDir - Build directory
 * @param {string} step - Checkpoint step name
 * @returns {Promise<void>}
 */
export async function createCheckpoint(buildDir, step) {
  const checkpointFile = path.join(buildDir, '.build-checkpoint')
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
 *
 * @param {string} buildDir - Build directory
 * @returns {Promise<object|null>} Checkpoint data or null
 */
export async function readCheckpoint(buildDir) {
  const checkpointFile = path.join(buildDir, '.build-checkpoint')
  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Clean checkpoint.
 *
 * @param {string} buildDir - Build directory
 * @returns {Promise<void>}
 */
export async function cleanCheckpoint(buildDir) {
  const checkpointFile = path.join(buildDir, '.build-checkpoint')
  try {
    await fs.unlink(checkpointFile)
  } catch {
    // Ignore errors.
  }
}

/**
 * Check network connectivity.
 *
 * @returns {Promise<object>} Connection status
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
 *
 * @param {string} version - Git tag version
 * @returns {Promise<object>} Tag verification result
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
