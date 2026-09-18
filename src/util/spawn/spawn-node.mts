import { resolveNodeRuntime } from './node-runtime.mts'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type {
  SpawnExtra,
  SpawnOptions,
  SpawnResult,
} from '@socketsecurity/lib-stable/process/spawn/types'

export async function spawnNode(
  args: string[] | readonly string[],
  options?: SpawnOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<SpawnResult> {
  const runtime = await resolveNodeRuntime(options)
  return spawn(
    runtime.executable,
    args,
    { __proto__: null, ...options, env: runtime.environment },
    extra,
  )
}
