import { existsSync } from 'node:fs'

import { whichBin } from '@socketsecurity/registry/lib/bin'

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
): Promise<string> {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new InputError(
        `--bazel path does not exist: ${explicit}. Install bazelisk or bazel, or pass an existing path via --bazel.`,
      )
    }
    return explicit
  }
  // Prefer bazelisk: respects .bazelversion in the workspace.
  const bazelisk = await whichBin('bazelisk', { nothrow: true })
  if (bazelisk) {
    return bazelisk
  }
  const bazel = await whichBin('bazel', { nothrow: true })
  if (bazel) {
    return bazel
  }
  throw new InputError(
    'Could not find bazelisk or bazel on PATH. ' +
      'Install bazelisk (recommended; https://github.com/bazelbuild/bazelisk) ' +
      'or bazel, or pass --bazel <path>.',
  )
}
