import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchLicensePolicy(
  orgSlug: string
): Promise<CResult<SocketSdkReturnType<'getOrgLicensePolicy'>['data']>> {
  const sockSdk = await setupSdk()

  return await handleApiCall(
    sockSdk.getOrgLicensePolicy(orgSlug),
    'looking up organization quota',
    'Received organization license policy response.',
    'Error fetching organization license policy',
    'getOrgLicensePolicy'
  )
}
