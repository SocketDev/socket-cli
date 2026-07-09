/**
 * Socketsecurity package install helpers for the Python CLI spawn utilities.
 *
 * Extracted from spawn-pycli.mts to keep that file under the 500-line soft
 * cap. Installs the `socketsecurity` PyPI package into a provisioned Python
 * environment, guarded by a lock file so concurrent socket processes don't
 * race the install, and reports whether it's already present.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'

import {
  convertCaretToPipRange,
  downloadPyPiWheel,
} from './spawn-pycli-wheel.mts'
import { getPyCliChecksums } from '../../env/pycli-checksums.mts'
import { getPyCliVersion } from '../../env/pycli-version.mts'
import { InputError } from '../error/errors.mts'

/**
 * Install socketsecurity package into the Python environment. Uses a lock file
 * to prevent races when multiple processes install concurrently.
 *
 * @param pythonBin Path to Python executable.
 * @param retryCount Internal retry counter to prevent unbounded recursion.
 */
export async function ensureSocketPyCli(
  pythonBin: string,
  retryCount = 0,
): Promise<void> {
  const MAX_RETRIES = 3

  if (retryCount >= MAX_RETRIES) {
    throw new InputError(
      `could not acquire the Socket Python CLI install lock after ${MAX_RETRIES} retries; another socket process may be stuck, or the lock file is stale — check for stale lock files under the Python cache dir and retry`,
    )
  }

  if (await isSocketPyCliInstalled(pythonBin)) {
    return
  }

  // Create lock file to prevent concurrent installation.
  const pythonDir = path.dirname(pythonBin)
  const lockFile = path.join(pythonDir, '.installing-socketcli')

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
        // Stale lock detected, remove and retry immediately.
        await safeDelete(lockFile, { force: true })
        return ensureSocketPyCli(pythonBin, retryCount + 1)
      }

      // Lock is valid, wait for installation to complete.
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => {
          setTimeout(resolve, 1000)
        })
        if (await isSocketPyCliInstalled(pythonBin)) {
          return
        }
        // Periodically re-check if lock holder is still alive.
        if (i % 5 === 4) {
          try {
            const lockPid = await fs.readFile(lockFile, 'utf8')
            const pid = Number.parseInt(lockPid.trim(), 10)
            if (!Number.isNaN(pid) && pid > 0 && !isProcessAlive(pid)) {
              // Lock holder died during wait, retry.
              await safeDelete(lockFile, { force: true })
              return ensureSocketPyCli(pythonBin, retryCount + 1)
            }
          } catch {
            // Lock file gone, retry.
            return ensureSocketPyCli(pythonBin, retryCount + 1)
          }
        }
      }
      // Timeout after 30 seconds, retry anyway.
      return ensureSocketPyCli(pythonBin, retryCount + 1)
    }
    throw e
  }

  try {
    const pyCliVersion = getPyCliVersion()

    // Get checksum for integrity verification.
    // Checksums are keyed by wheel filename in bundle-tools.json.
    const wheelFilename = `socketsecurity-${pyCliVersion}-py3-none-any.whl`
    const checksums = getPyCliChecksums()
    const sha256 = checksums[wheelFilename]

    // If checksums are available, download verified wheel and install from local file.
    // Otherwise fall back to pip install (dev mode or missing checksums).
    if (sha256) {
      const wheelPath = await downloadPyPiWheel(
        'socketsecurity',
        pyCliVersion,
        sha256,
      )
      if (wheelPath) {
        await spawn(pythonBin, ['-m', 'pip', 'install', '--quiet', wheelPath], {
          shell: WIN32,
          stdio: 'inherit',
        })
        /* c8 ignore start - defensive: downloadPyPiWheel returns a string or throws */
      } else {
        throw new InputError(
          `could not download the verified socketsecurity==${pyCliVersion} wheel (downloadPyPiWheel returned null — likely a checksum mismatch or missing wheel asset); re-run with --debug for details, or bump the version in bundle-tools.json if the checksum needs refreshing`,
        )
      }
      /* c8 ignore stop */
    } else {
      // Dev mode: no checksums inlined, install directly from PyPI.
      const versionSpec = convertCaretToPipRange(pyCliVersion)
      const packageSpec = versionSpec
        ? `socketsecurity${versionSpec}`
        : 'socketsecurity'

      await spawn(pythonBin, ['-m', 'pip', 'install', '--quiet', packageSpec], {
        shell: WIN32,
        stdio: 'inherit',
      })
    }
  } finally {
    // Clean up lock file.
    await safeDelete(lockFile, { force: true })
  }
}

/**
 * Whether the process at `pid` is still alive. Signal 0 sends no actual
 * signal, only checking existence/permission. EPERM means the process exists
 * but we lack permission to signal it (treat as alive); any other error
 * (e.g. ESRCH) means it's dead.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Check if socketcli is installed in the Python environment.
 */
export async function isSocketPyCliInstalled(
  pythonBin: string,
): Promise<boolean> {
  try {
    const result = await spawn(
      pythonBin,
      ['-c', 'import socketsecurity.socketcli'],
      {
        shell: WIN32,
      },
    )
    return result.code === 0
  } catch {
    return false
  }
}
