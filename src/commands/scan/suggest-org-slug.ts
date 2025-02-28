import { select } from '@socketsecurity/registry/lib/prompts'
import { SocketSdk } from '@socketsecurity/sdk'

import { handleApiCall } from '../../utils/api.ts'

export async function suggestOrgSlug(
  socketSdk: SocketSdk
): Promise<string | void> {
  const result = await handleApiCall(
    socketSdk.getOrganizations(),
    'looking up organizations'
  )
  // Ignore a failed request here. It was not the primary goal of
  // running this command and reporting it only leads to end-user confusion.
  if (result.success) {
    const proceed = await select<string>({
      message:
        'Missing org name; do you want to use any of these orgs for this scan?',
      choices: Array.from(Object.values(result.data.organizations))
        .map(({ name: slug }) => ({
          name: 'Yes [' + slug + ']',
          value: slug,
          description: `Use "${slug}" as the organization`
        }))
        .concat({
          name: 'No',
          value: '',
          description:
            'Do not use any of these organizations (will end in a no-op)'
        })
    })
    if (proceed) {
      return proceed
    }
  } else {
    // TODO: in verbose mode, report this error to stderr
  }
}
