/** @fileoverview Config unset output formatting for Socket CLI. Displays success/failure messages for configuration key removal with formatted output in JSON/text modes. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputConfigUnset(
  updateResult: CResult<undefined | string>,
  outputKind: OutputKind,
) {
  outputResult(updateResult, outputKind, {
    success: data => {
      if (outputKind === 'markdown') {
        logger.log(`# Update config`)
        logger.log('')
        logger.log(updateResult.message)
        if (data) {
          logger.log('')
          logger.log(data)
        }
      } else {
        logger.log(`OK`)
        logger.log(updateResult.message)
        if (data) {
          logger.log('')
          logger.log(data)
        }
      }
      return ''
    },
  })
}
