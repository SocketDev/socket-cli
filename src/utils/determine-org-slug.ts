import { logger } from '@socketsecurity/registry/lib/logger'

import { getConfigValue, isTestingV1 } from './config'
import { suggestOrgSlug } from '../commands/scan/suggest-org-slug'

export async function determineOrgSlug(
  orgFlag: string,
  firstArg: string,
  interactive: boolean,
  dryRun: boolean
): Promise<[string, string]> {
  const defaultOrgSlug = getConfigValue('defaultOrg').data || ''
  let orgSlug = String(orgFlag || defaultOrgSlug || '')
  if (!orgSlug) {
    if (isTestingV1()) {
      // ask from server
      logger.error(
        'Missing the org slug and no --org flag set. Trying to auto-discover the org now...'
      )
      logger.error(
        'Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.'
      )
      if (dryRun) {
        logger.fail('Skipping auto-discovery of org in dry-run mode')
      } else if (!interactive) {
        logger.fail('Skipping auto-discovery of org when interactive = false')
      } else {
        orgSlug = (await suggestOrgSlug()) || ''
      }
    } else {
      orgSlug = firstArg || ''
    }
  }

  return [orgSlug, defaultOrgSlug]
}
