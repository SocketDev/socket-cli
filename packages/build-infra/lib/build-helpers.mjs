/**
 * Build Helper Utilities
 *
 * Provides utilities for checking prerequisites, validating environment,
 * and testing built binaries.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { whichBinSync } from '@socketsecurity/lib/bin'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'

import { printError, printStep, printSubstep, printWarning } from './build-output.mjs'

/**
 * Check available disk space.
 *
 * @param {string} dir - Directory to check
 * @param {number} [requiredGB=5] - Required GB (defaults to 5GB)
 * @returns {Promise<{availableGB: number|null, sufficient: boolean}>}
 */
export async function checkDiskSpace(dir, requiredGB = 5) {
  printStep('Checking disk space')

  try {
    const result = await spawn('df', ['-k', dir], {
      shell: WIN32,
      stdio: 'pipe',
      stdioString: true,
    })
    const lines = (result.stdout ?? '').trim().split('\n')
    if (lines.length < 2) {
      printWarning('Could not determine disk space')
      return { availableGB: null, sufficient: true }
    }

    const stats = lines[1].split(/\s+/)
    const availableKB = Number.parseInt(stats[3], 10)
    const availableBytes = availableKB * 1024
    const availableGBValue = Number((availableBytes / (1024 * 1024 * 1024)).toFixed(2))
    const sufficient = availableGBValue >= requiredGB

    return {
      availableGB: availableGBValue,
      sufficient,
    }
  } catch {
    printWarning('Could not check disk space')
    return { availableGB: null, sufficient: true }
  }
}

/**
 * Check if compiler is available.
 * Tries multiple compilers if none specified.
 *
 * @param {string|string[]} [compilers] - Compiler command(s) to check (e.g., 'clang++', ['clang++', 'g++', 'c++'])
 * @returns {Promise<{available: boolean, compiler: string|undefined}>}
 */
export async function checkCompiler(compilers) {
  const compilerList = Array.isArray(compilers)
    ? compilers
    : compilers
      ? [compilers]
      : ['clang++', 'g++', 'c++']

  for (const compiler of compilerList) {
    printStep(`Checking for ${compiler}`)

    const binPath = whichBinSync(compiler, { nothrow: true })
    if (binPath) {
      return { available: true, compiler }
    }
  }

  return { available: false, compiler: undefined }
}

/**
 * Check Python version.
 *
 * @param {string} [minVersion='3.6'] - Minimum required version (e.g., '3.8')
 * @returns {Promise<{available: boolean, sufficient: boolean, version: string|null}>}
 */
export async function checkPythonVersion(minVersion = '3.6') {
  printStep('Checking Python version')

  // Try multiple Python command names.
  // Use shell on all platforms to ensure PATH resolution works with setup-python.
  const pythonCommands = ['python3', 'python']

  for (const pythonCmd of pythonCommands) {
    try {
      const result = await spawn(
        pythonCmd,
        ['-c', "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
        { shell: true, stdio: 'pipe', stdioString: true }
      )

      // Debug: Log what we got back.
      printSubstep(`Tried ${pythonCmd}: status=${result?.status}, stdout="${result?.stdout?.trim()}", stderr="${result?.stderr?.trim()}"`)

      // Check if spawn failed or returned undefined status.
      if (!result || result.status === undefined || result.status === null) {
        continue
      }

      if (result.status !== 0) {
        if (result.stderr) {
          printWarning(`${pythonCmd} failed: ${result.stderr}`)
        }
        continue
      }

      const version = (result.stdout ?? '').trim()
      if (!version) {
        continue
      }

      const [major, minor] = version.split('.').map(Number)
      const [minMajor, minMinor] = minVersion.split('.').map(Number)

      const sufficient = major > minMajor || (major === minMajor && minor >= minMinor)

      return {
        available: true,
        sufficient,
        version,
      }
    } catch (e) {
      // Debug: Log the error.
      printSubstep(`${pythonCmd} threw error: ${e.message}`)
      continue
    }
  }

  // None of the Python commands worked.
  return {
    available: false,
    sufficient: false,
    version: null,
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
    const result = await spawn(binaryPath, args, {
      shell: WIN32,
      stdio: 'pipe',
      stdioString: true,
    })

    if ((result.status ?? 0) !== 0) {
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
    const result = await spawn(
      'curl',
      ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--connect-timeout', '5', 'https://github.com'],
      { shell: WIN32, stdio: 'pipe', stdioString: true }
    )

    const statusCode = (result.stdout ?? '').trim()
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
    const result = await spawn(
      'git',
      ['ls-remote', '--tags', 'https://github.com/nodejs/node.git', version],
      { shell: WIN32, stdio: 'pipe', stdioString: true }
    )

    return {
      exists: (result.stdout ?? '').includes(version),
      output: result.stdout,
    }
  } catch {
    return { exists: false, output: null }
  }
}
