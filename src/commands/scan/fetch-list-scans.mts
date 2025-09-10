import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
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
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchOrgFullScanList(
  config: FetchOrgFullScanListConfig,
  options?: FetchOrgFullScanListOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgFullScanList'>['data']>> {
  const { sdkOpts } = {
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

  return await handleApiCall(
    sockSdk.getOrgFullScanList(orgSlug, {
      ...(branch ? { branch } : {}),
      ...(repo ? { repo } : {}),
      sort,
      direction,
      from: from_time,
      page: String(page),
      per_page: String(perPage),
    }),
    { description: 'list of scans' },
  )
}
