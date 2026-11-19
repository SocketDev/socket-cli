import {
  accessSync,
  existsSync,
  constants as fsConstants,
  statSync,
} from 'node:fs'
import path from 'node:path'

import {
  findBazelExecutable,
  isNodeScript,
  resolveBazelExecutable,
} from './process.mts'
import { isStandaloneSea } from '../../../sea/runtime.mts'
import { InputError } from '../../../utils/errors.mts'

/**
 * Resolve the bazel binary to invoke for `socket manifest bazel`.
 *
 * Resolution order:
 *   1. SOCKET_CLI_BAZEL_PATH, else `explicit`: return it iff it exists on disk;
 *      else throw.
 *   2. Look up `bazelisk` on PATH (preferred — respects `.bazelversion`).
 *   3. Fall back to `bazel` on PATH.
 *   4. If neither is found, throw InputError with install instructions.
 */
export async function resolveBazelBinary(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string> {
  // As the other build tools take theirs from SOCKET_CLI_<TOOL>_PATH, ahead of
  // a named binary.
  const fromEnv = env['SOCKET_CLI_BAZEL_PATH']
  const override = fromEnv || explicit
  if (isStandaloneSea()) {
    if (!override) {
      throw new InputError(
        'Bazel is not bundled with this standalone Socket CLI. Set SOCKET_CLI_BAZEL_PATH or pass --bazel with an installed native Bazel executable.',
      )
    }
    const resolved = path.resolve(cwd, override)
    try {
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        throw new Error('not a file')
      }
      if (process.platform !== 'win32') {
        accessSync(resolved, fsConstants.X_OK)
      }
    } catch {
      throw new InputError(
        `The standalone Bazel path '${resolved}' is missing or not executable.`,
      )
    }
    const bin = resolveBazelExecutable(resolved)
    if (/^bazelisk(?:\.exe)?$/i.test(path.basename(bin))) {
      throw new InputError(
        'Standalone Socket requires an installed Bazel binary and will not use Bazelisk to download a Bazel version.',
      )
    }
    if (bin === process.execPath || isNodeScript(bin)) {
      throw new InputError(
        'Standalone Socket cannot launch Bazel through a JavaScript launcher because process.execPath is the SEA executable. Set SOCKET_CLI_BAZEL_PATH to a native Bazel executable.',
      )
    }
    return bin
  }
  if (override) {
    const named = fromEnv ? 'SOCKET_CLI_BAZEL_PATH' : '--bazel'
    const resolved = path.resolve(cwd, override)
    if (!existsSync(resolved)) {
      throw new InputError(
        `${named} path does not exist: ${resolved}. Install bazelisk or bazel, or name an existing path with ${named}.`,
      )
    }
    return resolveBazelExecutable(resolved)
  }
  // Prefer bazelisk: respects .bazelversion in the workspace.
  const bazelisk = await findBazelExecutable('bazelisk', env, cwd)
  if (bazelisk) {
    return bazelisk
  }
  const bazel = await findBazelExecutable('bazel', env, cwd)
  if (bazel) {
    return bazel
  }
  throw new InputError(
    'Could not find bazelisk or bazel on PATH. ' +
      'Install bazelisk (recommended; https://github.com/bazelbuild/bazelisk) ' +
      'or bazel, or name its path with --bazel or SOCKET_CLI_BAZEL_PATH.',
  )
}
