import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mjs'
import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { Spinner } from '@socketsecurity/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchSupportedScanFileNamesOptions = {
  sdkOpts?: SetupSdkOptions | undefined
  spinner?: Spinner | undefined
}

export async function fetchSupportedScanFileNames(
  options?: FetchSupportedScanFileNamesOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getSupportedFiles'>['data']>> {
  const { sdkOpts, spinner } = {
    __proto__: null,
    ...options,
  } as FetchSupportedScanFileNamesOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const orgSlugCResult = await getDefaultOrgSlug()
  if (!orgSlugCResult.ok) {
    return orgSlugCResult
  }

  return await handleApiCall<'getSupportedFiles'>(
    sockSdk.getSupportedFiles(orgSlugCResult.data),
    {
      description: 'supported scan file types',
      spinner,
    },
  )
}
