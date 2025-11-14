import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchDeleteOrgFullScanOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchDeleteOrgFullScan(
  orgSlug: string,
  scanId: string,
  options?: FetchDeleteOrgFullScanOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'deleteFullScan'>['data']>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchDeleteOrgFullScanOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'deleteFullScan'>(
    sockSdk.deleteFullScan(orgSlug, scanId),
    {
      commandPath,
      description: 'to delete a scan',
    },
  )
}
