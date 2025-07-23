import { debugFn } from '@socketsecurity/registry/lib/debug'

import { getConfigValueOrUndef } from '../../utils/config.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult } from '../../types.mts'

// Use the config defaultOrg when set, otherwise discover from remote.
export async function getDefaultOrgSlug(): Promise<CResult<string>> {
  const defaultOrgResult = getConfigValueOrUndef('defaultOrg')
  if (defaultOrgResult) {
    debugFn('notice', 'use: default org', defaultOrgResult)
    return { ok: true, data: defaultOrgResult }
  }

  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    return orgsCResult
  }

  const { organizations } = orgsCResult.data
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
