import { logger } from '@socketsecurity/registry/lib/logger'

import { mdTableOfPairs } from '../../utils/markdown'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputSecurityPolicy(
  data: SocketSdkReturnType<'getOrgSecurityPolicy'>['data'],
  outputKind: 'text' | 'json' | 'markdown'
): Promise<void> {
  if (outputKind === 'json') {
    let json
    try {
      json = JSON.stringify(data, null, 2)
    } catch {
      console.error(
        'Failed to convert the server response to json, try running the same command without --json'
      )
      return
    }

    logger.log(json)
    logger.log('')
    return
  }

  logger.log('# Security policy')
  logger.log('')
  logger.log(
    `The default security policy setting is: "${data.securityPolicyDefault}"`
  )
  logger.log('')
  logger.log(
    'These are the security policies per setting for your organization:'
  )
  logger.log('')
  const rules = data.securityPolicyRules
  const entries: Array<
    [string, { action: 'defer' | 'error' | 'warn' | 'monitor' | 'ignore' }]
  > = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(([key, value]) => [
    key,
    value.action
  ])
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  logger.log(mdTableOfPairs(mapped, ['name', 'action']))
  logger.log('')
}
