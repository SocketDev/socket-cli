import { existsSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { whichBin } from '@socketsecurity/registry/lib/bin'

import { InputError } from '../../../utils/errors.mts'

export type PythonShimResult = {
  // PATH-prefixed env to pass into spawn opts. undefined if no shim needed.
  augmentedEnv: NodeJS.ProcessEnv | undefined
  shimDir: string | undefined
}

// Stable shim dir name — same process will get the same dir; concurrent
// socket-cli invocations on the same machine share it. The symlink target
// is whatever python3 resolves to NOW; if PATH changes between invocations
// we replace the symlink.
const SHIM_SUBDIR = 'socket-cli-bazel-python-shim'

// Cache the result for the lifetime of this process.
let cached: PythonShimResult | null = null

// Safe wrapper around whichBin that returns null instead of throwing when
// nothrow semantics are broken in older registry versions (realpath 'null' bug).
async function safeWhichBin(name: string): Promise<string | null> {
  try {
    return (await whichBin(name, { nothrow: true })) ?? null
  } catch {
    return null
  }
}

export async function provisionPythonShim(): Promise<PythonShimResult> {
  if (cached) {
    return cached
  }
  const pythonOnPath = await safeWhichBin('python')
  if (pythonOnPath) {
    cached = { augmentedEnv: undefined, shimDir: undefined }
    return cached
  }
  const python3OnPath = await safeWhichBin('python3')
  if (!python3OnPath) {
    throw new InputError(
      'Neither `python` nor `python3` found on PATH. Older versions of ' +
        'rules_jvm_external require a `python` interpreter for repository ' +
        'rules. Install Python 3 and ensure it is on PATH, then retry.',
    )
  }
  const shimDir = path.join(os.tmpdir(), SHIM_SUBDIR)
  mkdirSync(shimDir, { recursive: true })
  const linkPath = path.join(shimDir, 'python')
  // Replace the symlink defensively in case python3's resolved path moved.
  if (existsSync(linkPath)) {
    try {
      unlinkSync(linkPath)
    } catch {
      // Tolerate races; the next symlinkSync may still succeed.
    }
  }
  // The shim dir is process-shared (os.tmpdir()/socket-cli-bazel-python-shim),
  // so a concurrent socket-cli invocation may re-create the link between our
  // unlinkSync and symlinkSync. Tolerate EEXIST when the link is back: the
  // other process won the race and left a usable shim in place.
  try {
    symlinkSync(python3OnPath, linkPath)
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code === 'EEXIST' &&
      existsSync(linkPath)
    ) {
      // Another process re-created the link; assume it points at a python3.
    } else {
      throw e
    }
  }
  const augmentedEnv = {
    ...process.env,
    PATH: `${shimDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
  }
  cached = { augmentedEnv, shimDir }
  return cached
}

// Test-only: clear the per-process cache so tests can re-mock whichBin.
export function _resetPythonShimCacheForTests(): void {
  cached = null
}
