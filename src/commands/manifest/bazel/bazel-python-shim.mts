import { execFileSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findBazelExecutable, prependBazelPath } from './bazel-process.mts'
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
    `Python 3 is required for Bazel manifest extraction. ${executable} did not run as Python 3. Install Python 3 and ensure python${process.platform === 'win32' ? '.exe' : ''} is on PATH.`,
  )
}

export async function provisionPythonShim(
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<PythonShimResult> {
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
