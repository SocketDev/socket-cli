import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { fetchOrganization } from '../organization/fetch-organization-list.mts'

export async function suggestOrgSlug(): Promise<string | void> {
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    logger.fail(
      'Failed to lookup organization list from API, unable to suggest',
    )
    return undefined
  }

  // Ignore a failed request here. It was not the primary goal of
  // running this command and reporting it only leads to end-user confusion.
  const { organizations } = orgsCResult.data
  const proceed = await select<string>({
    message:
      'Missing org name; do you want to use any of these orgs for this scan?',
    choices: [
      ...organizations.map(o => {
        const name = o.name ?? o.slug
        return {
          name: `Yes [${name}]`,
          value: name,
          description: `Use "${name}" as the organization`,
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
