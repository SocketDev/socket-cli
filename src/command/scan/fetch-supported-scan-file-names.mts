import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mjs'
import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../util/socket/sdk.mjs'
import type { SupportedFiles } from '../../util/fs/glob.mts'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'

export type FetchSupportedScanFileNamesOptions = {
  orgSlug?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
  spinner?: SpinnerInstance | undefined
}

export async function fetchSupportedScanFileNames(
  options?: FetchSupportedScanFileNamesOptions | undefined,
): Promise<CResult<SupportedFiles>> {
  const { orgSlug, sdkOpts, spinner } = {
    __proto__: null,
    ...options,
  } as FetchSupportedScanFileNamesOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  // Use provided orgSlug or discover it.
  let resolvedOrgSlug = orgSlug
  /* c8 ignore start -- defensive: getDefaultOrgSlug discovery path; all unit-test callers pass orgSlug explicitly, and the .mjs/.mts boundary makes mocking getDefaultOrgSlug unreliable in this test file */
  if (!resolvedOrgSlug) {
    const orgSlugCResult = await getDefaultOrgSlug()
    if (!orgSlugCResult.ok) {
      return orgSlugCResult
    }
    resolvedOrgSlug = orgSlugCResult.data
  }
  /* c8 ignore stop */

  return await handleApiCall<'getSupportedFiles'>(
    sockSdk.getSupportedFiles(resolvedOrgSlug),
    {
      description: 'supported scan file types',
      spinner,
    },
  )
}
