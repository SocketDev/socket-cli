import { debugLog } from '@socketsecurity/registry/lib/debug'

import { handleApiCall } from '../../utils/api'
import { getConfigValue } from '../../utils/config'
import { setupSdk } from '../../utils/sdk'

import type { CResult } from '../../types'

// Use the config defaultOrg when set, otherwise discover from remote
export async function getDefaultOrgSlug(): Promise<CResult<string>> {
  const defaultOrgResult = getConfigValue('defaultOrg')
  if (!defaultOrgResult.ok) {
    return defaultOrgResult
  }

  if (defaultOrgResult.data) {
    debugLog(`Using default org: ${defaultOrgResult.data}`)
    return { ok: true, data: defaultOrgResult.data }
  }

  const sockSdk = await setupSdk()

  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'looking up organizations'
  )

  if (!result.success) {
    process.exitCode = 1
    return {
      ok: false,
      message: result.error,
      data: `Failed to fetch default organization from API. Unable to continue.${result.cause ? ` ( Reason given: ${result.cause} )` : ''}`
    }
  }

  const orgs = result.data.organizations
  const keys = Object.keys(orgs)

  if (!keys[0]) {
    process.exitCode = 1
    return {
      ok: false,
      message: 'Failed to establish identity',
      data: `API did not return any organization associated with the current API token. Unable to continue.`
    }
  }

  const slug = (keys[0] in orgs && orgs?.[keys[0]]?.name) ?? undefined

  if (!slug) {
    process.exitCode = 1
    return {
      ok: false,
      message: 'Failed to establish identity',
      data: `Was unable to determine the default organization for the current API token. Unable to continue.`
    }
  }

  debugLog(`Resolved org to: ${slug}`)
  return {
    ok: true,
    message: 'Retrieved default org from server',
    data: slug
  }
}
