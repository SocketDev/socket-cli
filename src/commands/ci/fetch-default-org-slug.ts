import { logger } from '@socketsecurity/registry/lib/logger'

import { handleApiCall } from '../../utils/api'
import { getConfigValue } from '../../utils/config'
import { setupSdk } from '../../utils/sdk'

// Use the config defaultOrg when set, otherwise discover from remote
export async function getDefaultOrgSlug(): Promise<string | void> {
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
      logger.fail(
        'Failed to fetch default organization from API. Unable to continue.'
      )
      process.exitCode = 1
      return
    }
    const orgs = result.data.organizations
    const keys = Object.keys(orgs)

    if (!keys[0]) {
      logger.fail(
        'Could not find default organization for the current API token. Unable to continue.'
      )
      process.exitCode = 1
      return
    }

    const slug = (keys[0] in orgs && orgs?.[keys[0]]?.name) ?? undefined

    if (slug) {
      defaultOrg = slug
      logger.info(`Resolved org to: ${defaultOrg}`)
    }
  }

  if (!defaultOrg) {
    logger.fail(
      'Could not find the default organization for the current API token. Unable to continue.'
    )
    process.exitCode = 1
    return
  }

  return defaultOrg
}
