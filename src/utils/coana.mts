import { readJsonSync } from '@socketsecurity/registry/lib/fs'

import { getDefaultOrgSlug } from '../commands/ci/fetch-default-org-slug.mts'
import constants from '../constants.mts'
import { getDefaultApiToken } from './sdk.mts'
import shadowBin from '../shadow/npm/bin.mts'

import type { ShadowBinOptions } from '../shadow/npm/bin.mts'
import type { CResult } from '../types.mts'
import type { SpawnExtra } from '@socketsecurity/registry/lib/spawn'

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
  options?: ShadowBinOptions | undefined,
  extra?: SpawnExtra | undefined,
): Promise<CResult<string>> {
  const {
    env: spawnEnv,
    ipc,
    ...spawnOpts
  } = {
    __proto__: null,
    ...options,
  } as ShadowBinOptions
  const mixinsEnv: NodeJS.ProcessEnv = {
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
    const { spawnPromise } = await shadowBin(
      'npx',
      [
        '--yes',
        `@coana-tech/cli@~${constants.ENV.INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION}`,
        ...args,
      ],
      {
        ...spawnOpts,
        env: {
          ...process.env,
          ...constants.processEnv,
          ...mixinsEnv,
          ...spawnEnv,
        },
        ipc: {
          [constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]: true,
          [constants.SOCKET_CLI_SHADOW_API_TOKEN]:
            constants.SOCKET_PUBLIC_API_TOKEN,
          [constants.SOCKET_CLI_SHADOW_SILENT]: true,
          ...ipc,
        },
      },
      extra,
    )
    const output = await spawnPromise
    return { ok: true, data: output.stdout }
  } catch (e) {
    const stderr = (e as any)?.stderr
    const message = stderr ? stderr : (e as Error)?.message
    return { ok: false, data: e, message }
  }
}
