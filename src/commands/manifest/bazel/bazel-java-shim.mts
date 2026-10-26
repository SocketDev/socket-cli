import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { getBazelEnvironmentValue } from './bazel-process.mts'
import { InputError } from '../../../utils/errors.mts'

export function ensureJavaOnPath(env: NodeJS.ProcessEnv, cwd: string): void {
  const javaHome = getBazelEnvironmentValue(env, 'JAVA_HOME')
  const executable = process.platform === 'win32' ? 'java.exe' : 'java'
  const java = javaHome
    ? path.resolve(cwd, javaHome, 'bin', executable)
    : executable
  try {
    execFileSync(java, ['-version'], {
      cwd,
      env,
      stdio: 'ignore',
      timeout: 10_000,
    })
  } catch {
    throw new InputError(
      'Java is required for Bazel JVM manifest extraction. Install a JDK and ensure JAVA_HOME points to it or java is on PATH.',
    )
  }
}
