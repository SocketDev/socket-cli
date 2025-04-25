import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputQuota(
  data: SocketSdkReturnType<'getQuota'>['data'],
  outputKind: OutputKind = 'text'
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

  if (outputKind === 'markdown') {
    logger.log('# Quota')
    logger.log('')
    logger.log(`Quota left on the current API token: ${data.quota}`)
    logger.log('')
    return
  }

  logger.log(`Quota left on the current API token: ${data.quota}`)
  logger.log('')
}
