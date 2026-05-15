/* max-file-lines: legitimate — tracks one cohesive module domain; splitting would scatter tightly coupled helpers. */
/**
 * Python CLI spawn utilities.
 * These use bundled Python from SEA VFS or download portable Python via DLX.
 *
 * Resolution order for both Python and socketcli:
 * 1. SOCKET_CLI_PYTHON_PATH / SOCKET_CLI_PYCLI_LOCAL_PATH env vars (local dev).
 * 2. Bundled Python from SEA VFS (SEA binary installations).
 * 3. Portable Python download via DLX (npm/pnpm/yarn installations).
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { downloadBinary, getDlxCachePath } from '@socketsecurity/lib-stable/dlx/binary'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs'
import { spawn } from '@socketsecurity/lib-stable/spawn'
import { whichReal } from '@socketsecurity/lib-stable/bin'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'

import { resolvePyCli } from './resolve-binary.mjs'
import {
  areBasicsToolsAvailable,
  extractBasicsTools,
  getBasicsToolPaths,
} from '../basics/vfs-extract.mts'
import { getPyCliChecksums } from '../../env/pycli-checksums.mts'
import { getPyCliVersion } from '../../env/pycli-version.mts'
import { getPythonBuildTag } from '../../env/python-build-tag.mts'
import { requirePythonChecksum } from '../../env/python-checksums.mts'
import { getPythonVersion } from '../../env/python-version.mts'
import { SOCKET_CLI_PYTHON_PATH } from '../../env/socket-cli-python-path.mts'
import { InputError, getErrorCause } from '../error/errors.mts'
import { isSeaBinary } from '../sea/detect.mts'
import { socketHttpRequest } from '../socket/api.mjs'
import { spawnNode } from '../spawn/spawn-node.mjs'

import type { DlxOptions } from './spawn.mts'
import type { SpawnNodeOptions } from '../spawn/spawn-node.mts'
import type { CResult } from '../../types.mjs'

/**
 * Convert npm caret range (^2.2.15) to pip version specifier (>=2.2.15,<3.0.0).
 */
export function convertCaretToPipRange(caretRange: string): string {
  if (!caretRange) {
    return ''
  }

  if (!caretRange.startsWith('^')) {
    return `==${caretRange}`
  }

  const version = caretRange.slice(1) // Remove '^'.

  // Handle malformed caret range (just "^" with no version).
  if (!version) {
    return ''
  }

  const parts = version.split('.')
  const major = Number.parseInt(parts[0] || '0', 10)
  // Handle non-numeric major version (e.g., "^x.2.3").
  if (Number.isNaN(major)) {
    return `==${version}`
  }
  const nextMajor = major + 1

  return `>=${version},<${nextMajor}.0.0`
}

/**
 * Download a PyPI wheel with SHA-256 verification.
 * Fetches the wheel URL from PyPI JSON API and downloads with integrity check.
 *
 * @param packageName - PyPI package name (e.g., 'socketsecurity').
 * @param version - Exact version to download.
 * @param sha256 - Expected SHA-256 checksum (hex string).
 * @returns Path to the downloaded wheel file, or null if download fails.
 */
export async function downloadPyPiWheel(
  packageName: string,
  version: string,
  sha256: string | undefined,
): Promise<string | undefined> {
  // Cache path: ~/.socket/_dlx/pypi/{package}/{version}/
  const cacheDir = path.join(getDlxCachePath(), 'pypi', packageName, version)
  const wheelFilename = `${packageName}-${version}-py3-none-any.whl`
  const wheelPath = path.join(cacheDir, wheelFilename)

  // Return cached wheel if already downloaded.
  if (existsSync(wheelPath)) {
    return wheelPath
  }

  await safeMkdir(cacheDir)

  // Fetch wheel URL from PyPI JSON API.
  const pypiUrl = `https://pypi.org/pypi/${packageName}/${version}/json`
  let wheelUrl: string | undefined = undefined

  try {
    const response = await socketHttpRequest(pypiUrl)
    if (!response.ok) {
      throw new Error(
        `PyPI returned HTTP ${response.status} for ${pypiUrl} (expected 200); check the package name and version, or retry if the registry is rate-limiting`,
      )
    }
    const data = response.json() as {
      urls?: Array<{ filename: string; url: string }>
    }

    // Find the wheel URL (prefer py3-none-any wheel).
    const wheelInfo = data.urls?.find(
      u =>
        u.filename.endsWith('-py3-none-any.whl') || u.filename.endsWith('.whl'),
    )
    if (wheelInfo) {
      wheelUrl = wheelInfo.url
    }
  } catch (e) {
    // If we can't fetch from API, construct URL directly (may not work for all packages).
    // This is a fallback; the API approach is more reliable.
    throw new InputError(
      `could not fetch PyPI metadata for ${packageName}==${version} from ${pypiUrl} (${getErrorCause(e)}); check your network or proxy settings, or try again if PyPI is rate-limiting`,
    )
  }

  if (!wheelUrl) {
    throw new InputError(
      `${packageName}==${version} has no py3-none-any wheel on PyPI (only sdist available); pin to a version that ships a wheel or install from source manually`,
    )
  }

  // Download wheel with SHA-256 verification.
  const result = await downloadBinary({
    name: wheelFilename,
    sha256,
    url: wheelUrl,
  })

  // Copy to our cache directory (downloadBinary uses its own cache).
  await fs.copyFile(result.binaryPath, wheelPath)

  return wheelPath
}

/**
 * Download and extract Python from python-build-standalone using downloadBinary.
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
 * Ensure Python is available via DLX download.
 * Uses a lock file to prevent concurrent downloads (TOCTOU protection).
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
            try {
              // Signal 0 checks process existence without sending actual signal.
              process.kill(pid, 0)
              // Process exists, lock is valid.
            } catch (pidError) {
              const pidErr = pidError as NodeJS.ErrnoException
              // EPERM means process exists but no permission (treat as alive).
              // ESRCH means process doesn't exist (dead).
              if (pidErr.code !== 'EPERM') {
                isStale = true
              }
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
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => {
            setTimeout(resolve, 1_000)
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
 * Install socketsecurity package into the Python environment.
 * Uses a lock file to prevent races when multiple processes install concurrently.
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
          try {
            // Signal 0 checks process existence.
            process.kill(pid, 0)
            // Process exists, lock is valid.
          } catch (pidError) {
            const pidErr = pidError as NodeJS.ErrnoException
            // EPERM means process exists but no permission (treat as alive).
            // ESRCH means process doesn't exist (dead).
            if (pidErr.code !== 'EPERM') {
              isStale = true
            }
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
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => {
          setTimeout(resolve, 1_000)
        })
        // eslint-disable-next-line no-await-in-loop
        if (await isSocketPyCliInstalled(pythonBin)) {
          return
        }
        // Periodically re-check if lock holder is still alive.
        if (i % 5 === 4) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const lockPid = await fs.readFile(lockFile, 'utf8')
            const pid = Number.parseInt(lockPid.trim(), 10)
            if (!Number.isNaN(pid) && pid > 0) {
              try {
                process.kill(pid, 0)
              } catch (pidError) {
                const pidErr = pidError as NodeJS.ErrnoException
                if (pidErr.code !== 'EPERM') {
                  // Lock holder died during wait, retry.
                  // eslint-disable-next-line no-await-in-loop
                  await safeDelete(lockFile, { force: true })
                  return ensureSocketPyCli(pythonBin, retryCount + 1)
                }
              }
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
        /* c8 ignore start */
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
 * Get the download URL and asset name for python-build-standalone based on platform and architecture.
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
      { shell: WIN32 },
    )
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Spawn socketcli (Socket Python CLI).
 * Ensures Python is available (SEA bundled or DLX downloaded) before spawning.
 */
export async function spawnSocketPyCli(
  args: string[] | readonly string[],
  options?: SocketPyCliDlxOptions | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as SocketPyCliDlxOptions

  const finalEnv: Record<string, string | undefined> = {
    ...process.env,
    ...spawnEnv,
  }

  try {
    // Check for local path override first.
    const resolution = resolvePyCli()
    if (resolution.type === 'local') {
      const spawnNodeOpts: SpawnNodeOptions = {
        ...(dlxOptions.cwd ? { cwd: dlxOptions.cwd } : {}),
        env: finalEnv,
        shell: WIN32,
        stdio: 'inherit',
      }
      const spawnResult = await spawnNode(
        [resolution.path, ...args],
        spawnNodeOpts,
      )

      return {
        data: spawnResult.stdout?.toString() ?? '',
        ok: true,
      }
    }

    // Ensure Python is available (SEA bundled or DLX downloaded).
    const pythonBin = await ensurePython()

    // Ensure socketsecurity package is installed.
    await ensureSocketPyCli(pythonBin)

    // Build environment - isolate PATH for SEA mode.
    const spawnEnvFinal =
      isSeaBinary() && areBasicsToolsAvailable()
        ? {
            ...finalEnv,
            // Isolate PATH to bundled tools directory for SEA.
            PATH: `${path.dirname(pythonBin)}:${path.dirname(path.dirname(pythonBin))}`,
          }
        : finalEnv

    // Run socketcli via python -m.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: spawnEnvFinal,
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    return {
      data: spawnResult.stdout?.toString() ?? '',
      ok: true,
    }
  } catch (e) {
    const cause = getErrorCause(e)
    return {
      data: e,
      message: cause,
      ok: false,
    }
  }
}

/**
 * Spawn socketcli via DLX-downloaded Python.
 * Downloads portable Python from python-build-standalone and installs socketsecurity.
 */
export async function spawnSocketPyCliDlx(
  args: string[] | readonly string[],
  options?: SocketPyCliDlxOptions | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as SocketPyCliDlxOptions

  const resolution = resolvePyCli()

  const finalEnv: Record<string, string | undefined> = {
    ...process.env,
    ...spawnEnv,
  }

  try {
    // Use local Python CLI if available.
    if (resolution.type === 'local') {
      const spawnNodeOpts: SpawnNodeOptions = {
        ...(dlxOptions.cwd ? { cwd: dlxOptions.cwd } : {}),
        env: finalEnv,
        shell: WIN32,
        stdio: 'inherit',
      }
      const spawnResult = await spawnNode(
        [resolution.path, ...args],
        spawnNodeOpts,
      )

      return {
        data: spawnResult.stdout?.toString() ?? '',
        ok: true,
      }
    }

    // Download portable Python via DLX infrastructure.
    const pythonBin = await ensurePythonDlx()

    // Ensure socketsecurity is installed.
    await ensureSocketPyCli(pythonBin)

    // Run socketcli via python -m.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: finalEnv,
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    return {
      data: spawnResult.stdout?.toString() ?? '',
      ok: true,
    }
  } catch (e) {
    const cause = getErrorCause(e)
    return {
      data: e,
      message: cause,
      ok: false,
    }
  }
}

export type SocketPyCliDlxOptions = DlxOptions

/**
 * Spawn socketcli via bundled Python from SEA VFS.
 * Uses the same Python as socket-basics for consistency.
 */
export async function spawnSocketPyCliVfs(
  args: string[] | readonly string[],
  options?: SocketPyCliDlxOptions | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...dlxOptions } = {
    __proto__: null,
    ...options,
  } as SocketPyCliDlxOptions

  try {
    const toolsDir = await extractBasicsTools()
    if (!toolsDir) {
      return {
        data: new Error('Failed to extract basics tools from VFS'),
        message: 'Failed to extract basics tools from VFS',
        ok: false,
      }
    }

    const toolPaths = getBasicsToolPaths(toolsDir)
    const pythonBin = toolPaths.python

    // Ensure socketsecurity package is installed with integrity verification.
    const pyCliVersion = getPyCliVersion()
    const wheelFilename = `socketsecurity-${pyCliVersion}-py3-none-any.whl`
    const checksums = getPyCliChecksums()
    const sha256 = checksums[wheelFilename]

    if (sha256) {
      // Download verified wheel and install from local file.
      const wheelPath = await downloadPyPiWheel(
        'socketsecurity',
        pyCliVersion,
        sha256,
      )
      if (wheelPath) {
        await spawn(pythonBin, ['-m', 'pip', 'install', '--quiet', wheelPath], {
          stdio: 'pipe',
        })
        /* c8 ignore start - defensive: downloadPyPiWheel returns a string or throws */
      } else {
        throw new Error(
          `failed to download socketsecurity==${pyCliVersion} wheel from PyPI (downloadPyPiWheel returned null — likely a checksum mismatch or missing py3-none-any wheel); re-run with --debug for details`,
        )
      }
      /* c8 ignore stop */
    } else {
      // Dev mode: install directly from PyPI.
      await spawn(
        pythonBin,
        ['-m', 'pip', 'install', '--quiet', `socketsecurity==${pyCliVersion}`],
        { stdio: 'pipe' },
      )
    }

    // Run socketcli with isolated PATH.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: {
          ...process.env,
          ...spawnEnv,
          // Isolate PATH to bundled tools only.
          PATH: `${path.dirname(pythonBin)}:${toolsDir}`,
        },
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    return {
      data: spawnResult.stdout?.toString() ?? '',
      ok: true,
    }
  } catch (e) {
    const cause = getErrorCause(e)
    return {
      data: e,
      message: cause,
      ok: false,
    }
  }
}
