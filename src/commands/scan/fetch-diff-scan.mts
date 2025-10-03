/** @fileoverview Scan diff API fetcher for Socket CLI. Retrieves differences between two security scans from Socket API. Compares issues, dependencies, and security scores across scan versions. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { queryApiJson, setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function fetchDiffScan({
  id1,
  id2,
  orgSlug,
  sdkOpts,
}: {
  id1: string
  id2: string
  orgSlug: string
  sdkOpts?: SetupSdkOptions | undefined
}): Promise<CResult<SocketSdkSuccessResult<'GetOrgDiffScan'>['data']>> {
  logger.info('Scan ID 1:', id1)
  logger.info('Scan ID 2:', id2)
  logger.info('Note: this request may take some time if the scans are big')

  const sdkResult = await setupSdk(sdkOpts)
  if (!sdkResult.ok) {
    return sdkResult
  }

  const sdk = sdkResult.data
  const result = await queryApiJson<
    SocketSdkSuccessResult<'GetOrgDiffScan'>['data']
  >(
    sdk,
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(id1)}&after=${encodeURIComponent(id2)}`,
    {
      throws: false,
      description: 'a scan diff',
    },
  )

  return result as CResult<SocketSdkSuccessResult<'GetOrgDiffScan'>['data']>
}
