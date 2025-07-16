import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'
import { getDefaultToken } from './sdk.mts'

import type { CResult } from '../types.mts'
import type {
  SpawnExtra,
  SpawnOptions,
} from '@socketsecurity/registry/lib/spawn'

export async function spawnCoana(
  args: string[] | readonly string[],
  options?: SpawnOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<CResult<unknown>> {
  const { env: spawnEnv } = { __proto__: null, ...options } as SpawnOptions
  try {
    const output = await spawn(
      constants.execPath,
      [
        // Lazily access constants.nodeNoWarningsFlags.
        ...constants.nodeNoWarningsFlags,
        // Lazily access constants.coanaBinPath.
        constants.coanaBinPath,
        ...args,
      ],
      {
        ...options,
        env: {
          ...process.env,
          // Lazily access constants.processEnv.
          ...constants.processEnv,
          SOCKET_CLI_API_TOKEN: getDefaultToken(),
          ...spawnEnv,
        },
      },
      extra,
    )
    return { ok: true, data: output.stdout }
  } catch (e) {
    const stderr = (e as any)?.stderr
    const message = stderr ? stderr : (e as Error)?.message
    return { ok: false, data: e, message }
  }
}
