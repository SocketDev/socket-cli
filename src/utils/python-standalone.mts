/** @fileoverview Python runtime management using python-build-standalone for Socket CLI. */

import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import semver from 'semver'

import { whichBin } from '@socketsecurity/registry/lib/bin'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'
import { getDlxCachePath } from './dlx-binary.mts'
import { InputError, getErrorCause } from './errors.mts'

import type { CResult } from '../types.mts'

const { ENV, PYTHON_MIN_VERSION, WIN32 } = constants

/**
 * Get the download URL for python-build-standalone based on platform and architecture.
 */
function getPythonStandaloneUrl(
  version: string = ENV['INLINED_SOCKET_CLI_PYTHON_VERSION'],
  tag: string = ENV['INLINED_SOCKET_CLI_PYTHON_BUILD_TAG'],
): string {
  const platform = os.platform()
  const arch = os.arch()

  let platformTriple: string

  if (platform === 'darwin') {
    platformTriple =
      arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  } else if (platform === 'linux') {
    platformTriple =
      arch === 'arm64'
        ? 'aarch64-unknown-linux-gnu'
        : 'x86_64-unknown-linux-gnu'
  } else if (platform === 'win32') {
    platformTriple = 'x86_64-pc-windows-msvc'
  } else {
    throw new InputError(`Unsupported platform: ${platform}`)
  }

  // URL encoding for the '+' in version string
  const encodedVersion = `${version}%2B${tag}`
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/cpython-${encodedVersion}-${platformTriple}-install_only.tar.gz`
}

/**
 * Get the path to the cached Python installation directory.
 */
function getPythonCachePath(): string {
  const version = ENV['INLINED_SOCKET_CLI_PYTHON_VERSION']
  const tag = ENV['INLINED_SOCKET_CLI_PYTHON_BUILD_TAG']
  const platform = os.platform()
  const arch = os.arch()

  return path.join(
    getDlxCachePath(),
    'python',
    `${version}-${tag}-${platform}-${arch}`,
  )
}

/**
 * Get the path to the Python executable within the installation.
 */
function getPythonBinPath(pythonDir: string): string {
  if (WIN32) {
    // Windows: python/python.exe
    return path.join(pythonDir, 'python', 'python.exe')
  }
  // POSIX: python/bin/python3
  return path.join(pythonDir, 'python', 'bin', 'python3')
}

/**
 * Check if system Python meets minimum version requirement.
 * Returns the path to Python executable if it meets requirements, null otherwise.
 */
export async function checkSystemPython(): Promise<string | null> {
  try {
    // Try python3 first, then python
    let pythonPath: string | string[] | null | undefined = await whichBin(
      'python3',
      { nothrow: true },
    )

    if (!pythonPath) {
      pythonPath = await whichBin('python', { nothrow: true })
    }

    if (!pythonPath) {
      return null
    }

    const pythonBin = Array.isArray(pythonPath) ? pythonPath[0]! : pythonPath

    // Get version
    const result = await spawn(pythonBin, ['--version'], {
      shell: WIN32,
    })

    const stdout =
      typeof result.stdout === 'string'
        ? result.stdout
        : result.stdout.toString('utf8')

    // Parse "Python 3.10.5" -> "3.10.5"
    const version = semver.coerce(stdout)

    if (!version) {
      return null
    }

    // Check if it meets minimum version
    if (semver.satisfies(version, `>=${PYTHON_MIN_VERSION}`)) {
      return pythonBin
    }

    return null
  } catch {
    return null
  }
}

/**
 * Download and extract Python from python-build-standalone.
 */
async function downloadPython(pythonDir: string): Promise<void> {
  const url = getPythonStandaloneUrl()
  const tarballPath = path.join(pythonDir, 'python.tar.gz')

  // Ensure directory exists
  await fs.mkdir(pythonDir, { recursive: true })

  // Download
  const response = await fetch(url)
  if (!response.ok) {
    throw new InputError(
      `Failed to download Python: ${response.status} ${response.statusText}`,
    )
  }

  // Save tarball
  const fileStream = createWriteStream(tarballPath)
  // @ts-expect-error - ReadableStream from fetch is compatible with pipeline
  await pipeline(response.body, fileStream)

  // Extract using system tar command
  await spawn('tar', ['-xzf', tarballPath, '-C', pythonDir], {
    shell: WIN32,
  })

  // Clean up tarball
  await fs.unlink(tarballPath)
}

/**
 * Ensure Python is available, either from system or by downloading.
 * Returns the path to the Python executable.
 */
export async function ensurePython(): Promise<string> {
  // Check system Python first
  const systemPython = await checkSystemPython()
  if (systemPython) {
    return systemPython
  }

  // Use cached Python or download it
  const pythonDir = getPythonCachePath()
  const pythonBin = getPythonBinPath(pythonDir)

  if (!existsSync(pythonBin)) {
    // Download and extract
    await downloadPython(pythonDir)

    // Verify it was extracted correctly
    if (!existsSync(pythonBin)) {
      throw new InputError(
        `Python binary not found after extraction: ${pythonBin}`,
      )
    }

    // Make executable on POSIX
    if (!WIN32) {
      await fs.chmod(pythonBin, 0o755)
    }
  }

  return pythonBin
}

/**
 * Check if socketcli is installed in the Python environment.
 */
async function isSocketCliInstalled(pythonBin: string): Promise<boolean> {
  try {
    const result = await spawn(
      pythonBin,
      ['-c', 'import socketsecurity.socketcli'],
      { shell: WIN32 },
    )
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Install socketsecurity package into the Python environment.
 */
export async function ensureSocketCli(pythonBin: string): Promise<void> {
  // Check if already installed
  if (await isSocketCliInstalled(pythonBin)) {
    return
  }

  // Install socketsecurity
  await spawn(
    pythonBin,
    ['-m', 'pip', 'install', '--quiet', 'socketsecurity'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )
}

/**
 * Run socketcli with arguments using managed or system Python.
 */
export async function spawnSocketPython(
  args: string[] | readonly string[],
  options?: {
    cwd?: string
    env?: Record<string, string>
    stdio?: 'inherit' | 'pipe'
  },
): Promise<CResult<string>> {
  try {
    // Ensure Python is available
    const pythonBin = await ensurePython()

    // Ensure socketcli is installed
    await ensureSocketCli(pythonBin)

    const finalEnv = {
      ...process.env,
      ...constants.processEnv,
      ...options?.env,
    }

    // Run socketcli via python -m
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        cwd: options?.cwd,
        env: finalEnv,
        shell: WIN32,
        stdio: options?.stdio || 'inherit',
      },
    )

    return {
      ok: true,
      data: spawnResult.stdout ? spawnResult.stdout.toString() : '',
    }
  } catch (e) {
    return {
      ok: false,
      data: e,
      message: getErrorCause(e),
    }
  }
}
