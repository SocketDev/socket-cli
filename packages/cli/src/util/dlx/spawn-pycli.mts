/**
 * Python CLI spawn utilities. These use bundled Python from SEA VFS or download
 * portable Python via DLX.
 *
 * Resolution order for both Python and socketcli:
 *
 * 1. SOCKET_CLI_PYTHON_PATH / SOCKET_CLI_PYCLI_LOCAL_PATH env vars (local dev).
 * 2. Bundled Python from SEA VFS (SEA binary installations).
 * 3. Portable Python download via DLX (npm/pnpm/yarn installations).
 */

import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'

import { resolvePyCli } from './resolve-binary.mjs'
import {
  areBasicsToolsAvailable,
  extractBasicsTools,
  getBasicsToolPaths,
} from '../basics/vfs-extract.mts'
import { ensureSocketPyCli } from './spawn-pycli-install.mts'
import { downloadPyPiWheel } from './spawn-pycli-wheel.mts'
import { ensurePython, ensurePythonDlx } from './spawn-pycli-python.mts'
import { getPyCliChecksums } from '../../env/pycli-checksums.mts'
import { getPyCliVersion } from '../../env/pycli-version.mts'
import { getErrorCause } from '../error/errors.mts'
import { isSeaBinary } from '../sea/detect.mts'
import { spawnNode } from '../spawn/spawn-node.mjs'

import type { DlxOptions } from './spawn.mts'
import type { SpawnNodeOptions } from '../spawn/spawn-node.mjs'
import type { CResult } from '../../types.mjs'

export type SocketPyCliDlxOptions = DlxOptions

/**
 * Spawn socketcli (Socket Python CLI). Ensures Python is available (SEA bundled
 * or DLX downloaded) before spawning.
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
 * Spawn socketcli via DLX-downloaded Python. Downloads portable Python from
 * python-build-standalone and installs socketsecurity.
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

/**
 * Spawn socketcli via bundled Python from SEA VFS. Uses the same Python as
 * socket-basics for consistency.
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

// Wheel resolution helpers extracted to keep this file under the 500-line File-size cap.
export {
  convertCaretToPipRange,
  downloadPyPiWheel,
} from './spawn-pycli-wheel.mts'

// Python provisioning helpers extracted to keep this file under the 500-line File-size cap.
export {
  downloadPython,
  ensurePython,
  ensurePythonDlx,
  getPythonBinPath,
  getPythonCachePath,
  getPythonStandaloneInfo,
} from './spawn-pycli-python.mts'

// socketsecurity install helpers extracted to keep this file under the 500-line File-size cap.
export {
  ensureSocketPyCli,
  isSocketPyCliInstalled,
} from './spawn-pycli-install.mts'
