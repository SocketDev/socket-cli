import { detectExecutableType } from '@socketsecurity/lib-stable/dlx/detect'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  formatMissingCdxgenLocalPathMessage,
  isMissingCdxgenLocalPath,
} from './cdxgen-diagnostics.mts'
import { spawnDlx } from './spawn.mts'
import { resolveCdxgen } from './resolve-binary.mjs'
import { InputError } from '../error/errors.mts'
import { getExecPath } from '@socketsecurity/lib-stable/constants/node'

import type { DlxOptions, DlxSpawnResult } from './spawn.mts'
import type { StdioOptions } from 'node:child_process'
import type { SpawnExtra } from '@socketsecurity/lib-stable/process/spawn/types'

/**
 * Helper to spawn cdxgen with dlx. If SOCKET_CLI_CDXGEN_LOCAL_PATH environment
 * variable is set, uses the local cdxgen binary at that path instead of
 * downloading from npm.
 */
export async function spawnCdxgen(
  args: string[] | readonly string[],
  options?: DlxOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxSpawnResult> {
  const resolution = resolveCdxgen()

  // Use local cdxgen if available.
  if (resolution.type === 'local') {
    // Check the override before spawning. Otherwise a wrong path surfaces as a
    // bare ENOENT that never mentions the environment variable, so the
    // override looks like it was ignored.
    if (isMissingCdxgenLocalPath(resolution.path)) {
      throw new InputError(formatMissingCdxgenLocalPathMessage(resolution.path))
    }
    const detection = detectExecutableType(resolution.path)
    const { env: spawnEnv, ...dlxOptions } = {
      __proto__: null,
      ...options,
    } as DlxOptions

    const nodeResolution =
      detection.type === 'binary' ? undefined : getExecPath()
    const spawnArgs = nodeResolution ? [resolution.path, ...args] : [...args]
    const spawnCommand = nodeResolution ?? resolution.path
    const baseEnv = {
      ...process.env,
      ...spawnEnv,
    }

    const spawnPromise = spawn(spawnCommand, spawnArgs, {
      ...dlxOptions,
      env: baseEnv,
      stdio: (spawnExtra?.['stdio'] as StdioOptions | undefined) ?? 'inherit',
    })

    return {
      spawnPromise,
    }
  }

  // Use dlx version (resolveCdxgen only returns 'local' or 'dlx' types).
  if (resolution.type !== 'dlx') {
    throw new Error(
      `internal: resolveCdxgen returned resolution.type="${resolution.type}" (expected "dlx"); this is a resolver contract bug — re-run with --debug and report the output`,
    )
  }
  return await spawnDlx(
    resolution.details,
    args,
    { force: false, ...options },
    spawnExtra,
  )
}
