import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchOrganization(): Promise<
  CResult<SocketSdkReturnType<'getOrganizations'>['data']>
> {
  const sockSdk = await setupSdk()

  return await handleApiCall(sockSdk.getOrganizations(), 'organization list')
}
