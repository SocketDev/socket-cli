import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { handleApiCall } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

export async function suggestOrgSlug(): Promise<string | void> {
  const sockSdk = await setupSdk()
  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'looking up organizations'
  )
  // Ignore a failed request here. It was not the primary goal of
  // running this command and reporting it only leads to end-user confusion.
  if (result.success) {
    const proceed = await select<string>({
      message:
        'Missing org name; do you want to use any of these orgs for this scan?',
      choices: [
        ...Object.values(result.data.organizations).map(org => {
          const slug = org.name ?? 'undefined'
          return {
            name: `Yes [${slug}]`,
            value: slug,
            description: `Use "${slug}" as the organization`
          }
        }),
        {
          name: 'No',
          value: '',
          description:
            'Do not use any of these organizations (will end in a no-op)'
        }
      ]
    })
    if (proceed) {
      return proceed
    }
  } else {
    logger.fail(
      'Failed to lookup organization list from API, unable to suggest'
    )
  }
}
