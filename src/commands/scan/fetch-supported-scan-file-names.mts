import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchSupportedScanFileNamesOptions = {
  orgSlug?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
  spinner?: Spinner | undefined
  silence?: boolean | undefined
}

export async function fetchSupportedScanFileNames(
  options?: FetchSupportedScanFileNamesOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'getSupportedFiles'>['data']>> {
  const {
    orgSlug,
    sdkOpts,
    silence = false,
    spinner,
  } = {
    __proto__: null,
    ...options,
  } as FetchSupportedScanFileNamesOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  // getSupportedFiles is org-scoped in SDK v4. Use the provided org or
  // discover the default one.
  let resolvedOrgSlug = orgSlug
  if (!resolvedOrgSlug) {
    const orgSlugCResult = await getDefaultOrgSlug()
    if (!orgSlugCResult.ok) {
      return orgSlugCResult
    }
    resolvedOrgSlug = orgSlugCResult.data
  }

  return await handleApiCall(sockSdk.getSupportedFiles(resolvedOrgSlug), {
    description: 'supported scan file types',
    spinner,
    silence,
  })
}
