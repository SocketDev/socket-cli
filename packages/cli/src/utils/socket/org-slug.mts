import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { suggestOrgSlug } from '../../commands/scan/suggest-org-slug.mjs'
import { suggestToPersistOrgSlug } from '../../commands/scan/suggest-to-persist-orgslug.mjs'
import { CONFIG_KEY_DEFAULT_ORG } from '../../constants/config.mjs'
import { V1_MIGRATION_GUIDE_URL } from '../../constants/socket.mts'
import { getConfigValueOrUndef } from '../config.mts'
import { webLink } from '../terminal/link.mjs'

export async function determineOrgSlug(
  orgFlag: string,
  interactive: boolean,
  dryRun: boolean,
): Promise<[string, string | undefined]> {
  const defaultOrgSlug = getConfigValueOrUndef(CONFIG_KEY_DEFAULT_ORG)
  let orgSlug = String(orgFlag || defaultOrgSlug || '')
  if (!orgSlug) {
    if (!interactive) {
      getDefaultLogger().warn(
        'Note: This command requires an org slug because the Socket API endpoint does.',
      )
      getDefaultLogger().warn('')
      getDefaultLogger().warn(
        'It seems no default org was setup and the `--org` flag was not used.',
      )
      getDefaultLogger().warn(
        "Additionally, `--no-interactive` was set so we can't ask for it.",
      )
      getDefaultLogger().warn(
        'Since v1.0.0 the org _argument_ for all commands was dropped in favor of an',
      )
      getDefaultLogger().warn(
        'implicit default org setting, which will be setup when you run `socket login`.',
      )
      getDefaultLogger().warn('')
      getDefaultLogger().warn(
        'Note: When running in CI, you probably want to set the `--org` flag.',
      )
      getDefaultLogger().warn('')
      getDefaultLogger().warn(
        `For details, see the ${webLink(V1_MIGRATION_GUIDE_URL, 'v1 migration guide')}`,
      )
      getDefaultLogger().warn('')
      getDefaultLogger().warn(
        'This command will exit now because the org slug is required to proceed.',
      )
      return ['', undefined]
    }

    getDefaultLogger().warn(
      'Unable to determine the target org. Trying to auto-discover it now...',
    )
    getDefaultLogger().info('Note: Run `socket login` to set a default org.')
    getDefaultLogger().error(
      '      Use the --org flag to override the default org.',
    )
    getDefaultLogger().error('')
    if (dryRun) {
      getDefaultLogger().fail('Skipping auto-discovery of org in dry-run mode')
    } else {
      orgSlug = (await suggestOrgSlug()) || ''
      if (orgSlug) {
        await suggestToPersistOrgSlug(orgSlug)
      }
    }
  }

  return [orgSlug, defaultOrgSlug]
}
