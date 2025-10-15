import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'




export type FetchSupportedScanFileNamesOptions = {
  sdkOpts?: SetupSdkOptions | undefined
  spinner?: Spinner | undefined
}

export async function fetchSupportedScanFileNames(
  options?: FetchSupportedScanFileNamesOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getReportSupportedFiles'>['data']>> {
  const { sdkOpts, spinner } = {
    __proto__: null,
    ...options,
  } as FetchSupportedScanFileNamesOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall(sockSdk.getSupportedScanFiles(), {
    description: 'supported scan file types',
    spinner,
  })
}
