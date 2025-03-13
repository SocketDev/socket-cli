import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function getQuota(
  format: 'text' | 'json' | 'markdown' = 'text'
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  await getQuotaWithToken(apiToken, format)
}

async function getQuotaWithToken(
  apiToken: string,
  format: 'text' | 'json' | 'markdown' = 'text'
) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization quota...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getQuota(),
    'looking up organization quota'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getQuota', result)
    return
  }

  spinner.stop()

  switch (format) {
    case 'json': {
      logger.log(
        JSON.stringify(
          {
            quota: result.data.quota
          },
          null,
          2
        )
      )
      return
    }
    case 'markdown': {
      logger.log('# Quota\n')
      logger.log(`Quota left on the current API token: ${result.data.quota}\n`)
      return
    }
    default: {
      logger.log(`Quota left on the current API token: ${result.data.quota}\n`)
    }
  }
}
