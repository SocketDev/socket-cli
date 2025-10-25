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
