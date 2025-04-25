import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { CliJsonResult } from '../../types'
import { handleApiCall } from '../../utils/api'
import { getConfigValue } from '../../utils/config'
import { setupSdk } from '../../utils/sdk'

// Use the config defaultOrg when set, otherwise discover from remote
export async function getDefaultOrgSlug(): Promise<CliJsonResult<string>> {
  let defaultOrg = getConfigValue('defaultOrg')
  if (defaultOrg) {
    logger.info(`Using default org: ${defaultOrg}`)
  } else {
    const sockSdk = await setupSdk()
    const result = await handleApiCall(
      sockSdk.getOrganizations(),
      'looking up organizations'
    )
    // Ignore a failed request here. It was not the primary goal of
    // running this command and reporting it only leads to end-user confusion.
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

    if (slug) {
      defaultOrg = slug
      debugLog(`Resolved org to: ${defaultOrg}`)
    }
  }

  if (!defaultOrg) {
    process.exitCode = 1
    return {
      ok: false,
      message: 'Failed to establish identity',
      data: `Was unable to determine the default organization for the current API token. Unable to continue.`
    }
  }

  return { ok: true, data: defaultOrg }
}
