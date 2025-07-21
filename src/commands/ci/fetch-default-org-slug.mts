import { debugFn } from '@socketsecurity/registry/lib/debug'

import { handleApiCall } from '../../utils/api.mts'
import { getConfigValueOrUndef } from '../../utils/config.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'

// Use the config defaultOrg when set, otherwise discover from remote.
export async function getDefaultOrgSlug(): Promise<CResult<string>> {
  const defaultOrgResult = getConfigValueOrUndef('defaultOrg')

  if (defaultOrgResult) {
    debugFn('notice', 'use: default org', defaultOrgResult)
    return { ok: true, data: defaultOrgResult }
  }

  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'list of organizations',
  )

  if (!result.ok) {
    return result
  }

  const { organizations } = result.data
  const keys = Object.keys(organizations)

  if (!keys.length) {
    return {
      ok: false,
      message: 'Failed to establish identity',
      data: `API did not return any organization associated with the current API token. Unable to continue.`,
    }
  }

  const slug = (organizations as any)[keys[0]!]?.name ?? undefined

  if (!slug) {
    return {
      ok: false,
      message: 'Failed to establish identity',
      data: `Was unable to determine the default organization for the current API token. Unable to continue.`,
    }
  }

  debugFn('notice', 'resolve: org', slug)

  return {
    ok: true,
    message: 'Retrieved default org from server',
    data: slug,
  }
}
