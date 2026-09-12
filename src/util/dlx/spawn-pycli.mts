import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isWin32 } from '@socketsecurity/lib-stable/constants/platform'

import { resolvePyCli } from './resolve-binary.mjs'

import { ensureSocketPyCli } from './spawn-pycli-install.mts'
import { ensurePython } from './spawn-pycli-python.mts'
import { getErrorCause } from '../error/errors.mts'

import { spawnNode } from '../spawn/spawn-node.mjs'

import type { DlxOptions } from './spawn.mts'
import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'
import type { CResult } from '../../types.mjs'

export type SocketPyCliDlxOptions = DlxOptions

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
      const spawnNodeOpts: SpawnOptions = {
        ...(dlxOptions.cwd ? { cwd: dlxOptions.cwd } : {}),
        env: finalEnv,
        shell: isWin32(),
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

    const pythonBin = await ensurePython()

    // Ensure socketsecurity package is installed.
    await ensureSocketPyCli(pythonBin)

    // Run socketcli via python -m.
    const spawnResult = await spawn(
      pythonBin,
      ['-m', 'socketsecurity.socketcli', ...args],
      {
        ...dlxOptions,
        env: finalEnv,
        shell: isWin32(),
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
