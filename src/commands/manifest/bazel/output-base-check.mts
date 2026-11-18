import {
  accessSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
} from 'node:fs'
import path from 'node:path'

import { InputError, getErrorCause } from '../../../utils/errors.mts'

// Validates that --bazel-output-base is a path we can use as Bazel's output_base.
// Throws InputError if:
//   - the input contains `..` segments (path traversal guard)
//   - the existing path is not writable
//   - the path cannot be created (parent not writable)
export function validateOutputBase(outputBase: string, cwd: string): void {
  // Path traversal guard: reject any literal `..` segment in user input.
  // After path.resolve these are normalised away, so we check the raw input.
  // Split on both separators. On Windows `path.sep === '\\'`, so
  // input like `foo/../etc` would not contain a `..` segment under the
  // platform-specific split, bypassing the guard — yet path.resolve below
  // would still normalise the `..` and a traversal target could materialise.
  const segments = outputBase.split(/[\\/]/)
  if (segments.includes('..')) {
    throw new InputError(
      `--bazel-output-base must not contain '..' segments: ${outputBase}`,
    )
  }
  const resolved = path.resolve(cwd, outputBase)
  if (existsSync(resolved)) {
    try {
      accessSync(resolved, fsConstants.W_OK)
    } catch {
      throw new InputError(`--bazel-output-base is not writable: ${resolved}`)
    }
    return
  }
  // Path does not exist yet — try to create it so bazel can populate it.
  try {
    mkdirSync(resolved, { recursive: true })
  } catch (e) {
    throw new InputError(
      `--bazel-output-base could not be created at ${resolved}: ${getErrorCause(e)}`,
    )
  }
}
