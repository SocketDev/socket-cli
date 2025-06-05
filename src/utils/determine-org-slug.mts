import { logger } from '@socketsecurity/registry/lib/logger'

import { getConfigValueOrUndef } from './config.mts'
import { suggestOrgSlug } from '../commands/scan/suggest-org-slug.mts'

export async function determineOrgSlug(
  orgFlag: string,
  interactive: boolean,
  dryRun: boolean,
): Promise<[string, string | undefined]> {
  const defaultOrgSlug = getConfigValueOrUndef('defaultOrg')
  let orgSlug = String(orgFlag || defaultOrgSlug || '')
  if (!orgSlug) {
    // ask from server
    logger.warn(
      'Missing the org slug and no --org flag set. Trying to auto-discover the org now...',
    )
    logger.info(
      'Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.',
    )
    if (dryRun) {
      logger.fail('Skipping auto-discovery of org in dry-run mode')
    } else if (!interactive) {
      logger.fail('Skipping auto-discovery of org when interactive = false')
    } else {
      orgSlug = (await suggestOrgSlug()) || ''
    }
  }

  return [orgSlug, defaultOrgSlug]
}
