import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchSecurityPolicyOptions = {
  commandPath?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export async function fetchSecurityPolicy(
  orgSlug: string,
  options?: FetchSecurityPolicyOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchSecurityPolicyOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  return await handleApiCall<'getOrgSecurityPolicy'>(
    sockSdk.getOrgSecurityPolicy(orgSlug),
    {
      commandPath,
      description: 'organization security policy',
    },
  )
}
