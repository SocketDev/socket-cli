import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

export async function suggestOrgSlug(): Promise<string | void> {
  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return
  }
  const sockSdk = sockSdkCResult.data

  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'list of organizations',
  )

  // Ignore a failed request here. It was not the primary goal of
  // running this command and reporting it only leads to end-user confusion.
  if (result.ok) {
    const proceed = await select<string>({
      message:
        'Missing org name; do you want to use any of these orgs for this scan?',
      choices: [
        ...Object.values(result.data.organizations).map(org => {
          const name = org.name ?? org.slug
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
    if (proceed === undefined) {
      return undefined
    }
    if (proceed) {
      return proceed
    }
  } else {
    logger.fail(
      'Failed to lookup organization list from API, unable to suggest',
    )
  }
}
