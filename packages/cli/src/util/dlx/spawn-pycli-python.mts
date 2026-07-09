/**
 * Python interpreter provisioning helpers for the Python CLI spawn utilities.
 *
 * Extracted from spawn-pycli.mts to keep that file under the 500-line soft
 * cap. Resolves the python-build-standalone asset for the current platform,
 * downloads/extracts it, and ensures a usable Python is on disk (local
 * override, SEA bundled, or DLX downloaded), guarded by a lock file so
 * concurrent socket processes don't race the download.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  downloadBinary,
  getDlxCachePath,
} from '@socketsecurity/lib-stable/dlx/binary'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { whichReal } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'

import {
  areBasicsToolsAvailable,
  extractBasicsTools,
  getBasicsToolPaths,
} from '../basics/vfs-extract.mts'
import { getPythonBuildTag } from '../../env/python-build-tag.mts'
import { isProcessAlive } from './spawn-pycli-install.mts'
import { requirePythonChecksum } from '../../env/python-checksums.mts'
import { getPythonVersion } from '../../env/python-version.mts'
import { SOCKET_CLI_PYTHON_PATH } from '../../env/socket-cli-python-path.mts'
import { InputError } from '../error/errors.mts'
import { isSeaBinary } from '../sea/detect.mts'

/**
 * Download and extract Python from python-build-standalone using
 * downloadBinary.
 */
export async function downloadPython(pythonDir: string): Promise<void> {
  const { assetName, url } = getPythonStandaloneInfo()
  const tarballName = 'python-standalone.tar.gz'

  // Get SHA-256 checksum for integrity verification.
  // In dev mode (checksums not inlined), returns undefined to allow development.
  // In production builds, missing checksums throw a HARD ERROR.
  const sha256 = requirePythonChecksum(assetName)

  await safeMkdir(pythonDir, { recursive: true })

  const result = await downloadBinary({
    name: tarballName,
    sha256,
    url,
  })

  // Extract the tarball to pythonDir.
  const tarPath = await whichReal('tar', { nothrow: true })
  if (!tarPath || Array.isArray(tarPath)) {
    throw new InputError(
      `tar is required to extract the Python standalone archive but was not found on PATH; install tar (e.g. \`apt install tar\`, \`brew install gnu-tar\`) and re-run`,
    )
  }
  await spawn(tarPath, ['-xzf', result.binaryPath, '-C', pythonDir], {})
}

/**
 * Ensure Python is available (local override, SEA bundled, or DLX downloaded).
 * Returns the path to the Python executable.
 */
export async function ensurePython(): Promise<string> {
  // Check for local Python path override.
  if (SOCKET_CLI_PYTHON_PATH) {
    return SOCKET_CLI_PYTHON_PATH
  }

  // Use bundled Python from VFS in SEA mode.
  if (isSeaBinary() && areBasicsToolsAvailable()) {
    const toolsDir = await extractBasicsTools()
    if (toolsDir) {
      const toolPaths = getBasicsToolPaths(toolsDir)
      return toolPaths.python
    }
  }

  // Fallback to DLX-downloaded Python.
  return await ensurePythonDlx()
}

/**
 * Ensure Python is available via DLX download. Uses a lock file to prevent
 * concurrent downloads (TOCTOU protection).
 *
 * @param retryCount Internal retry counter to prevent unbounded recursion.
 */
export async function ensurePythonDlx(retryCount = 0): Promise<string> {
  const MAX_RETRIES = 3

  const pythonDir = getPythonCachePath()
  const pythonBin = getPythonBinPath(pythonDir)
  const lockFile = path.join(pythonDir, '.downloading')

  if (retryCount >= MAX_RETRIES) {
    throw new InputError(
      `could not acquire the Python install lock after ${MAX_RETRIES} retries at ${lockFile}; another socket process may be stuck, or the lock file is stale — remove it manually and retry, or check that ${pythonDir} is writable`,
    )
  }

  if (!existsSync(pythonBin)) {
    await safeMkdir(pythonDir, { recursive: true })

    // Try to acquire lock atomically.
    try {
      await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' })
    } catch (e: unknown) {
      const error = e as NodeJS.ErrnoException
      if (error.code === 'EEXIST') {
        // Check if lock is stale by reading PID.
        let isStale = false
        try {
          const lockPid = await fs.readFile(lockFile, 'utf8')
          const pid = Number.parseInt(lockPid.trim(), 10)
          if (!Number.isNaN(pid) && pid > 0) {
            if (!isProcessAlive(pid)) {
              isStale = true
            }
          } else {
            isStale = true
          }
        } catch {
          // Could not read lock file, may have been removed.
          isStale = true
        }

        if (isStale) {
          // Stale lock detected, remove and retry.
          await safeDelete(lockFile, { force: true })
          return ensurePythonDlx(retryCount + 1)
        }

        // Lock is valid, wait for download to complete.
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => {
            setTimeout(resolve, 1000)
          })
          if (existsSync(pythonBin)) {
            return pythonBin
          }
        }
        throw new InputError(
          `timed out after 60s waiting for another socket process to finish downloading Python to ${pythonDir}; if no other socket process is running, remove ${lockFile} and retry`,
        )
      }
      throw e
    }

    try {
      await downloadPython(pythonDir)

      if (!existsSync(pythonBin)) {
        throw new InputError(
          `Python archive extracted but ${pythonBin} does not exist; the standalone archive layout may have changed — check the asset contents under ${pythonDir} and update the bin-path logic in spawn.mts`,
        )
      }

      // Make executable on POSIX.
      if (!WIN32) {
        await fs.chmod(pythonBin, 0o755)
      }
    } finally {
      // Clean up lock file.
      await safeDelete(lockFile, { force: true })
    }
  }

  return pythonBin
}

/**
 * Get the path to the Python executable within the installation.
 */
export function getPythonBinPath(pythonDir: string): string {
  /* c8 ignore start - Windows-only branch; CI/test env mocks WIN32=false */
  if (WIN32) {
    return path.join(pythonDir, 'python', 'python.exe')
  }
  /* c8 ignore stop */
  return path.join(pythonDir, 'python', 'bin', 'python3')
}

/**
 * Get the path to the cached Python installation directory.
 */
export function getPythonCachePath(): string {
  const version = getPythonVersion()
  const tag = getPythonBuildTag()
  const platform = os.platform()
  const arch = os.arch()

  return path.join(
    getDlxCachePath(),
    'python',
    `${version}-${tag}-${platform}-${arch}`,
  )
}

/**
 * Get the download URL and asset name for python-build-standalone based on
 * platform and architecture.
 */
export function getPythonStandaloneInfo(): { assetName: string; url: string } {
  const version = getPythonVersion()
  const tag = getPythonBuildTag()
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
    // Windows ARM64 can use native ARM64 Python for better performance.
    platformTriple =
      arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  } else {
    throw new InputError(
      `python-build-standalone does not ship a prebuilt for os.platform()="${platform}" (supported: darwin, linux, win32); install Python manually and point socket at it via PATH`,
    )
  }

  // Asset name format matches checksums in bundle-tools.json.
  const assetName = `cpython-${version}+${tag}-${platformTriple}-install_only.tar.gz`
  // URL encoding for the '+' in version string.
  const encodedVersion = `${version}%2B${tag}`
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/cpython-${encodedVersion}-${platformTriple}-install_only.tar.gz`

  return { assetName, url }
}
