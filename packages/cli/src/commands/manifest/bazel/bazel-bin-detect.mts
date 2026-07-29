import { existsSync } from 'node:fs'

import { whichReal } from '@socketsecurity/lib-stable/bin/which'

import { InputError } from '../../../util/error/errors-types.mts'

// whichReal can return an array under `{ all: true }`; the single-lookup form
// used here yields a string or undefined, so collapse defensively.
export function firstBinPath(
  result: string | string[] | undefined,
): string | undefined {
  return Array.isArray(result) ? result[0] : result
}

/**
 * Resolve the bazel binary to invoke for `socket manifest bazel`.
 *
 * Resolution order:
 * 1. If `explicit` is provided, return it iff it exists on disk; else throw.
 * 2. Look up `bazelisk` on PATH (preferred — respects `.bazelversion`).
 * 3. Fall back to `bazel` on PATH.
 * 4. If neither is found, throw InputError with install instructions.
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
  const bazelisk = firstBinPath(await whichReal('bazelisk', { nothrow: true }))
  if (bazelisk) {
    return bazelisk
  }
  const bazel = firstBinPath(await whichReal('bazel', { nothrow: true }))
  if (bazel) {
    return bazel
  }
  throw new InputError(
    'Could not find bazelisk or bazel on PATH. ' +
      'Install bazelisk (recommended; https://github.com/bazelbuild/bazelisk) ' +
      'or bazel, or pass --bazel <path>.',
  )
}
