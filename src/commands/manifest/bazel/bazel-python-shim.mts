import { execFileSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  findBazelExecutable,
  getBazelEnvironment,
  getBazelEnvironmentValue,
} from './bazel-process.mts'
import { InputError } from '../../../utils/errors.mts'

export type PythonShimResult = {
  augmentedEnv: NodeJS.ProcessEnv | undefined
  shimDir: string | undefined
}

function verifyPython(
  executable: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): void {
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
    if (version.trim() === '3') {
      return
    }
  } catch {
    // Windows application aliases can resolve without a working interpreter.
  }
  throw new InputError(
    `Python 3 is required for Bazel manifest extraction. ${executable} did not run as Python 3. Install Python 3 and ensure python${process.platform === 'win32' ? '.exe' : ''} is on PATH.`,
  )
}

export async function provisionPythonShim(
  env: NodeJS.ProcessEnv = getBazelEnvironment(),
  cwd: string = process.cwd(),
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
    verifyPython(python, env, cwd)
    return { augmentedEnv: undefined, shimDir: undefined }
  }
  if (process.platform === 'win32') {
    throw new InputError(
      'Bazel on Windows requires a working Python 3 python.exe on PATH. Install Python 3 with the PATH option enabled, then retry.',
    )
  }
  const python3 = await findBazelExecutable('python3', env, cwd)
  if (!python3) {
    throw new InputError(
      'Neither python nor python3 was found on PATH. Install Python 3 and ensure it is on PATH, then retry.',
    )
  }
  verifyPython(python3, env, cwd)
  const shimDir = mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-python-'))
  symlinkSync(python3, path.join(shimDir, 'python'))
  return {
    augmentedEnv: getBazelEnvironment({
      ...env,
      PATH: `${shimDir}${path.delimiter}${getBazelEnvironmentValue(env, 'PATH') ?? ''}`,
    }),
    shimDir,
  }
}
