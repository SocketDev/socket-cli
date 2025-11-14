import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchOrgFullScanListConfig = {
  branch: string
  direction: string
  from_time: string
  orgSlug: string
  page: number
  perPage: number
  repo: string
  sort: string
}

export type FetchOrgFullScanListOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchOrgFullScanList(
  config: FetchOrgFullScanListConfig,
  options?: FetchOrgFullScanListOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'listFullScans'>['data']>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchOrgFullScanListOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const { branch, direction, from_time, orgSlug, page, perPage, repo, sort } = {
    __proto__: null,
    ...config,
  } as FetchOrgFullScanListConfig

  return await handleApiCall<'listFullScans'>(
    sockSdk.listFullScans(orgSlug, {
      ...(branch ? { branch } : {}),
      ...(repo ? { repo } : {}),
      ...(sort ? { sort: sort as 'name' | 'created_at' } : {}),
      ...(direction ? { direction: direction as 'asc' | 'desc' } : {}),
      from: from_time,
      page,
      per_page: perPage,
    }),
    {
      commandPath,
      description: 'list of scans',
    },
  )
}
