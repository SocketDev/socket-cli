import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchSupportedScanFileNames(): Promise<
  CResult<SocketSdkReturnType<'getReportSupportedFiles'>['data']>
> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getReportSupportedFiles(),
    'supported scan file types'
  )
}
