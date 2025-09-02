import { readJsonSync } from '@socketsecurity/registry/lib/fs'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
import constants from '../constants.mts'
import { getDefaultApiToken } from './sdk.mts'
import shadowBin from '../shadow/npm/bin.mts'

import type { CResult } from '../types.mts'
import type {
  SpawnExtra,
  SpawnOptions,
} from '@socketsecurity/registry/lib/spawn'

export function extractTier1ReachabilityScanId(
  socketFactsFile: string,
): string | undefined {
  const json = readJsonSync(socketFactsFile, { throws: false })
  const tier1ReachabilityScanId = String(
    json?.['tier1ReachabilityScanId'] ?? '',
  ).trim()
  return tier1ReachabilityScanId.length > 0
    ? tier1ReachabilityScanId
    : undefined
}

export async function spawnCoana(
  args: string[] | readonly string[],
  orgSlug?: string,
  options?: SpawnOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const { env: spawnEnv, ...spawnOpts } = {
    __proto__: null,
    ...options,
  } as SpawnOptions
  const mixinsEnv: Record<string, string> = {
    SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
  }
  const defaultApiToken = getDefaultApiToken()
  if (defaultApiToken) {
    mixinsEnv['SOCKET_CLI_API_TOKEN'] = defaultApiToken
  }

  if (orgSlug) {
    mixinsEnv['SOCKET_ORG_SLUG'] = orgSlug
  } else {
    const orgSlugCResult = await getDefaultOrgSlug()
    if (orgSlugCResult.ok) {
      mixinsEnv['SOCKET_ORG_SLUG'] = orgSlugCResult.data
    }
  }

  try {
    const output = await shadowBin(
      'npx',
      [
        '--yes',
        `@coana-tech/cli@~${constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}`,
        ...args,
      ],
      {
        ...spawnOpts,
        apiToken: constants.SOCKET_PUBLIC_API_TOKEN,
        env: {
          ...process.env,
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
