import { readJsonSync } from '@socketsecurity/registry/lib/fs'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
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
): Promise<CResult<string>> {
  const { env: spawnEnv } = { __proto__: null, ...options } as SpawnOptions
  const mixinsEnv: Record<string, string> = {
    // Lazily access constants.ENV.INLINED_SOCKET_CLI_VERSION.
    SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
  }
  const defaultApiToken = getDefaultToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }
  const orgSlugCResult = await getDefaultOrgSlug()
  if (orgSlugCResult.ok) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
  }
  try {
    const output = await spawn(
      constants.execPath,
      [
        // Lazily access constants.nodeNoWarningsFlags.
        ...constants.nodeNoWarningsFlags,
        // Lazily access constants.nodeMemoryFlags.
        ...constants.nodeMemoryFlags,
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
          ...mixinsEnv,
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

export function extractTier1ReachabilityScanId(
  socketFactsFile: string,
): string | undefined {
  const json = readJsonSync(socketFactsFile, { throws: false })
  const tier1ReachabilityScanId = json?.['tier1ReachabilityScanId']
  return typeof tier1ReachabilityScanId === 'string' && tier1ReachabilityScanId.length > 0
    ? tier1ReachabilityScanId
    : undefined
}
