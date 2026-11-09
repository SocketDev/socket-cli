import { execFileSync } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findBazelExecutable, prependBazelPath } from './bazel-process.mts'
import { isStandaloneSea } from '../../../sea/runtime.mts'
import { InputError } from '../../../utils/errors.mts'

export type PythonShimResult = {
  env: NodeJS.ProcessEnv
  shimDir: string | undefined
}

function isPython3(
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): boolean {
  try {
    const version = execFileSync(
      executable,
      ['-c', 'import sys\nprint(sys.version_info.major)'],
      {
        cwd,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      },
    )
    return version.trim() === '3'
  } catch {
    // Windows application aliases can resolve without a working interpreter.
    return false
  }
}

function notPython3Error(executable: string): InputError {
  return new InputError(
    `Python 3 is required for Bazel manifest extraction. ${executable} did not run as Python 3. Install Python 3 and ensure python${process.platform === 'win32' ? '.exe' : ''} is on PATH or set SOCKET_CLI_PYTHON_PATH in a standalone build.`,
  )
}

export async function provisionPythonShim(
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<PythonShimResult> {
  if (isStandaloneSea()) {
    const override = env['SOCKET_CLI_PYTHON_PATH']
    if (!override) {
      throw new InputError(
        'Python is not bundled with this standalone Socket CLI. Set SOCKET_CLI_PYTHON_PATH to an installed Python 3 executable for Bazel manifest extraction.',
      )
    }
    const executable = path.resolve(cwd, override)
    try {
      accessSync(
        executable,
        process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK,
      )
      if (!statSync(executable).isFile()) {
        throw new Error('not a file')
      }
    } catch {
      throw new InputError(
        `SOCKET_CLI_PYTHON_PATH must point to an executable Python 3 binary, but '${executable}' is missing or not executable.`,
      )
    }
    if (
      process.platform === 'win32' &&
      path.extname(executable).toLowerCase() !== '.exe'
    ) {
      throw new InputError(
        'Bazel on Windows requires SOCKET_CLI_PYTHON_PATH to point to a native Python 3 python.exe.',
      )
    }
    if (!isPython3(executable, env, cwd)) {
      throw notPython3Error(executable)
    }
    if (process.platform === 'win32') {
      if (path.basename(executable).toLowerCase() !== 'python.exe') {
        throw new InputError(
          "SOCKET_CLI_PYTHON_PATH must name python.exe on Windows so its adjacent DLLs and standard library remain available. Point it to the Python installation's python.exe.",
        )
      }
      return {
        env: prependBazelPath(env, path.dirname(executable)),
        shimDir: undefined,
      }
    }
    const shimDir = mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-python-'))
    try {
      for (const name of ['python', 'python3']) {
        const alias = path.join(shimDir, name)
        symlinkSync(executable, alias)
      }
    } catch (error) {
      rmSync(shimDir, { recursive: true, force: true })
      throw error
    }
    return { env: prependBazelPath(env, shimDir), shimDir }
  }
  const python = await findBazelExecutable('python', env, cwd)
  if (python) {
    if (
      process.platform === 'win32' &&
      path.extname(python).toLowerCase() !== '.exe'
    ) {
      throw new InputError(
        'Bazel on Windows requires a working Python 3 python.exe on PATH. Python batch launchers are not supported.',
      )
    }
    if (isPython3(python, env, cwd)) {
      return { env, shimDir: undefined }
    }
    if (process.platform === 'win32') {
      throw notPython3Error(python)
    }
  } else if (process.platform === 'win32') {
    throw new InputError(
      'Bazel on Windows requires a working Python 3 python.exe on PATH. Install Python 3 with the PATH option enabled, then retry.',
    )
  }
  const python3 = await findBazelExecutable('python3', env, cwd)
  if (!python3) {
    throw python
      ? notPython3Error(python)
      : new InputError(
          'Neither python nor python3 was found on PATH. Install Python 3 and ensure it is on PATH, then retry.',
        )
  }
  if (!isPython3(python3, env, cwd)) {
    throw notPython3Error(python3)
  }
  const shimDir = mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-python-'))
  symlinkSync(python3, path.join(shimDir, 'python'))
  return { env: prependBazelPath(env, shimDir), shimDir }
}
