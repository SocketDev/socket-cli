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
  sdkOptions?: SetupSdkOptions | undefined
}

export async function fetchOrgFullScanList(
  config: FetchOrgFullScanListConfig,
  options?: FetchOrgFullScanListOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgFullScanList'>['data']>> {
  const { sdkOptions } = {
    __proto__: null,
    ...options,
  } as FetchOrgFullScanListOptions

  const sockSdkCResult = await setupSdk(sdkOptions)
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
      per_page: String(perPage),
      page: String(page),
      from: from_time,
    }),
    { desc: 'list of scans' },
  )
}
