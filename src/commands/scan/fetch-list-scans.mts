/** @fileoverview Scan list API fetcher for Socket CLI. Retrieves paginated organization scan lists from Socket API. Supports filtering by branch, repository, time range, and sorting options. */

import { withSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
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

export type FetchOrgFullScanListOptions = BaseFetchOptions

export async function fetchOrgFullScanList(
  config: FetchOrgFullScanListConfig,
  options?: FetchOrgFullScanListOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgFullScanList'>['data']>> {
  const { branch, direction, from_time, orgSlug, page, perPage, repo, sort } = {
    __proto__: null,
    ...config,
  } as FetchOrgFullScanListConfig

  return await withSdk(
    sdk =>
      sdk.getOrgFullScanList(orgSlug, {
        ...(branch ? { branch } : {}),
        ...(repo ? { repo } : {}),
        sort,
        direction,
        from: from_time,
        page: String(page),
        per_page: String(perPage),
      }),
    'list of scans',
    options,
  )
}
