import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchSecurityPolicy(
  orgSlug: string
): Promise<CResult<SocketSdkReturnType<'getOrgSecurityPolicy'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getOrgSecurityPolicy(orgSlug),
    'organization security policy'
  )
}
