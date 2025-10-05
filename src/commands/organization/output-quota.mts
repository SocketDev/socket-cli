/** @fileoverview Organization quota output formatter for Socket CLI. Displays quota data in JSON, markdown, or text formats. Shows API quotas, scan quotas, and plan-specific usage limits. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputQuota(
  result: CResult<SocketSdkSuccessResult<'getQuota'>['data']>,
  outputKind: OutputKind = 'text',
): Promise<void> {
  outputResult(result, outputKind, {
    success: data => {
      if (outputKind === 'markdown') {
        logger.log('# Quota')
        logger.log('')
        logger.log(`Quota left on the current API token: ${data.quota}`)
        logger.log('')
        return ''
      }

      logger.log(`Quota left on the current API token: ${data.quota}`)
      logger.log('')
      return ''
    },
  })
}
