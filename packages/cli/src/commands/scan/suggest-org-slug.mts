import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { select } from '@socketsecurity/lib/stdio/prompts'

import { fetchOrganization } from '../organization/fetch-organization-list.mts'

export async function suggestOrgSlug(): Promise<string | undefined> {
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    const logger = getDefaultLogger()
    logger.fail(
      'Failed to lookup organization list from API, unable to suggest',
    )
    return undefined
  }

  const { organizations } = orgsCResult.data
  const proceed = await select({
    message:
      'Missing org name; do you want to use any of these orgs for this scan?',
    choices: [
      ...organizations.map(o => {
        // Display the human-readable name but route with the slug —
        // display names may contain spaces that break API URLs.
        const display = o.name ?? o.slug
        return {
          name: `Yes [${display}]`,
          value: o.slug,
          description: `Use "${display}" as the organization`,
        }
      }),
      {
        name: 'No',
        value: '',
        description:
          'Do not use any of these organizations (will end in a no-op)',
      },
    ],
  })

  if (proceed) {
    return proceed
  }
  return undefined
}
