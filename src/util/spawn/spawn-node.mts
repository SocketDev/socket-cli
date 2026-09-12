import { getExecPath } from '@socketsecurity/lib-stable/constants/node'
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
  return spawn(getExecPath(), args, options, extra)
}
