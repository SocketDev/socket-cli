import { debugFn } from '@socketsecurity/registry/lib/debug'

import constants from '../../constants.mts'
import { getConfigValueOrUndef } from '../../utils/config.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult } from '../../types.mts'

// Use the config defaultOrg when set, otherwise discover from remote.
export async function getDefaultOrgSlug(): Promise<CResult<string>> {
  const defaultOrgResult = getConfigValueOrUndef('defaultOrg')
  if (defaultOrgResult) {
    debugFn(
      'notice',
      'use: org from "defaultOrg" value of socket/settings local app data',
      defaultOrgResult,
    )
    return { ok: true, data: defaultOrgResult }
  }

  const envOrgSlug = constants.ENV.SOCKET_CLI_ORG_SLUG
  if (envOrgSlug) {
    debugFn(
      'notice',
      'use: org from SOCKET_CLI_ORG_SLUG environment variable',
      envOrgSlug,
    )
    return { ok: true, data: envOrgSlug }
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
      data: `No organization associated with the Socket API token. Unable to continue.`,
    }
  }

  const slug = (organizations as any)[keys[0]!]?.name ?? undefined
  if (!slug) {
    return {
      ok: false,
      message: 'Failed to establish identity',
      data: `Cannot determine the default organization for the API token. Unable to continue.`,
    }
  }

  debugFn('notice', 'resolve: org from Socket API', slug)

  return {
    ok: true,
    message: 'Retrieved default org from server',
    data: slug,
  }
}
