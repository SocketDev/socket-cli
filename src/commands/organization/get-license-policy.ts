import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function getLicensePolicy(
  orgSlug: string,
  format: 'text' | 'json' | 'markdown'
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  await getLicensePolicyWithToken(apiToken, orgSlug, format)
}

async function getLicensePolicyWithToken(
  apiToken: string,
  orgSlug: string,
  format: 'text' | 'json' | 'markdown'
) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organization quota...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    // socketSdk.getOrgLicensePolicy(orgSlug),
    socketSdk.getOrgSecurityPolicy(orgSlug), // tmp
    "looking up organization's license policy"
  )

  if (!result.success) {
    // handleUnsuccessfulApiResponse('getOrgLicensePolicy', result)
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
      // logger.log('# License policy\n')
      // logger.log(
      //   `These are the license policies set up for the requested organization:\n`
      // )
      // const data = result.data
      // const rules = data.securityPolicyRules
      // const entries: Array<
      //   [string, { action: 'defer' | 'error' | 'warn' | 'monitor' | 'ignore' | undefined}]
      // > = Object.entries(rules)
      // const mapped: Array<[string, string]> = entries.map(([key, value]) => [
      //   key,
      //   value.action
      // ])
      // mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      // logger.log(mdTable(mapped, ['name', 'action']))
    }
  }
}

// function mdTable(
//   arr: Array<[string, string]>,
//   // This is saying "an array of strings and the strings are a valid key of elements of T"
//   // In turn, T is defined above as the audit log event type from our OpenAPI docs.
//   cols: string[]
// ): string {
//   // Max col width required to fit all data in that column
//   const cws = cols.map(col => col.length)
//
//   for (const [key, val] of arr) {
//     cws[0] = Math.max(cws[0] ?? 0, String(key).length)
//     cws[1] = Math.max(cws[1] ?? 0, String(val ?? '').length)
//   }
//
//   let div = '|'
//   for (const cw of cws) div += ' ' + '-'.repeat(cw) + ' |'
//
//   let header = '|'
//   for (let i = 0; i < cols.length; ++i) {
//     header += ' ' + String(cols[i]).padEnd(cws[i] ?? 0, ' ') + ' |'
//   }
//
//   let body = ''
//   for (const [key, val] of arr) {
//     body += '|'
//     body += ' ' + String(key).padEnd(cws[0] ?? 0, ' ') + ' |'
//     body += ' ' + String(val ?? '').padEnd(cws[1] ?? 0, ' ') + ' |'
//     body += '\n'
//   }
//
//   return [div, header, div, body.trim(), div].filter(s => !!s.trim()).join('\n')
// }
