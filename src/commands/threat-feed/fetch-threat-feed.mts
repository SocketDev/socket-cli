import { setupSdk } from '../../utils/sdk.mts'

import type { ThreadFeedResponse } from './types.mts'
import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

export async function fetchThreatFeed({
  direction,
  ecosystem,
  filter,
  orgSlug,
  page,
  perPage,
  pkg,
  sdkOpts,
  version,
}: {
  direction: string
  ecosystem: string
  filter: string
  orgSlug: string
  page: string
  perPage: number
  pkg: string
  version: string
  sdkOpts?: SetupSdkOptions | undefined
}): Promise<CResult<ThreadFeedResponse>> {
  const sdkResult = await setupSdk(sdkOpts)
  if (!sdkResult.ok) {
    return sdkResult
  }

  const sdk = sdkResult.data
  const queryParams = new URLSearchParams([
    ['direction', direction],
    ['ecosystem', ecosystem],
    filter ? ['filter', filter] : ['', ''],
    ['page_cursor', page],
    ['per_page', String(perPage)],
    pkg ? ['name', pkg] : ['', ''],
    version ? ['version', version] : ['', ''],
  ])

  const result = await sdk.queryApiJson<ThreadFeedResponse>(
    `orgs/${orgSlug}/threat-feed?${queryParams}`,
    {
      throws: false,
      description: 'the Threat Feed data',
    },
  )

  return result as CResult<ThreadFeedResponse>
}
