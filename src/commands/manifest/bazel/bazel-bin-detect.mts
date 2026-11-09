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
} from './bazel-process.mts'
import { isStandaloneSea } from '../../../sea/runtime.mts'
import { InputError } from '../../../utils/errors.mts'

/**
 * Resolve the bazel binary to invoke for `socket manifest bazel`.
 *
 * Resolution order:
 *   1. If `explicit` is provided, return it iff it exists on disk; else throw.
 *   2. Look up `bazelisk` on PATH (preferred — respects `.bazelversion`).
 *   3. Fall back to `bazel` on PATH.
 *   4. If neither is found, throw InputError with install instructions.
 */
export async function resolveBazelBinary(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string> {
  if (isStandaloneSea()) {
    const override = explicit ?? env['SOCKET_CLI_BAZEL_PATH']
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
  if (explicit) {
    const resolved = path.resolve(cwd, explicit)
    if (!existsSync(resolved)) {
      throw new InputError(
        `--bazel path does not exist: ${resolved}. Install bazelisk or bazel, or pass an existing path via --bazel.`,
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
      'or bazel, or pass --bazel <path>.',
  )
}
