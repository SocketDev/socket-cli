import { logger } from '@socketsecurity/registry/lib/logger'

import { mdTableOfPairs } from '../../utils/markdown'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputLicensePolicy(
  data: SocketSdkReturnType<'getOrgLicensePolicy'>['data'],
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

  logger.error('Use --json to get the full result')
  logger.log('# License policy')
  logger.log('')
  logger.log('This is the license policy for your organization:')
  logger.log('')
  const rules = data.license_policy!
  const entries = rules ? Object.entries(rules) : []
  const mapped: Array<[string, string]> = entries.map(
    ([key, value]) => [key, value.allowed ? ' yes' : ' no'] as const
  )
  mapped.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  logger.log(mdTableOfPairs(mapped, ['License Name', 'Allowed']))
  logger.log('')
}
