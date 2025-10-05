/** @fileoverview Config set output formatting for Socket CLI. Displays success/failure messages for configuration updates with formatted output in JSON/text modes. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputConfigSet(
  result: CResult<undefined | string>,
  outputKind: OutputKind,
) {
  outputResult(result, outputKind, {
    success: data => {
      if (outputKind === 'markdown') {
        logger.log(`# Update config`)
        logger.log('')
        logger.log(result.message)
        if (data) {
          logger.log('')
          logger.log(data)
        }
      } else {
        logger.log(`OK`)
        logger.log(result.message)
        if (data) {
          logger.log('')
          logger.log(data)
        }
      }
      return ''
    },
  })
}
