import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { mdTableOfPairs } from '../../utils/markdown'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function getSecurityPolicy(
  orgSlug: string,
  format: 'text' | 'json' | 'markdown'
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  await getSecurityPolicyWithToken(apiToken, orgSlug, format)
}

async function getSecurityPolicyWithToken(
  apiToken: string,
  orgSlug: string,
  format: 'text' | 'json' | 'markdown'
) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization quota...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgSecurityPolicy(orgSlug),
    'looking up organization quota'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrgSecurityPolicy', result)
    return
  }

  spinner.stop()

  switch (format) {
    case 'json': {
      logger.log(JSON.stringify(result.data, null, 2))
      return
    }
    default: {
      logger.log('# Security policy\n')
      logger.log(
        `The default security policy setting is: "${result.data.securityPolicyDefault}"\n`
      )
      logger.log(
        'These are the security policies per setting for your organization:\n'
      )
      const data = result.data
      const rules = data.securityPolicyRules
      const entries: Array<
        [string, { action: 'defer' | 'error' | 'warn' | 'monitor' | 'ignore' }]
        // @ts-ignore -- not sure why TS is complaining tbh but it does not like it
      > = Object.entries(rules)
      const mapped: Array<[string, string]> = entries.map(([key, value]) => [
        key,
        value.action
      ])
      mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      logger.log(mdTableOfPairs(mapped, ['name', 'action']))
    }
  }
}
