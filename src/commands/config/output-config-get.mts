/** @fileoverview Config get output formatting for Socket CLI. Displays configuration value with source indication and formatted output in JSON/text modes. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { isConfigFromFlag } from '../../utils/config.mts'
import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function outputConfigGet(
  key: keyof LocalConfig,
  result: CResult<LocalConfig[keyof LocalConfig]>,
  outputKind: OutputKind,
) {
  outputResult(result, outputKind, {
    success: data => {
      const readOnly = isConfigFromFlag()

      if (outputKind === 'markdown') {
        logger.log(`# Config Value`)
        logger.log('')
        logger.log(`Config key '${key}' has value '${data}`)
        if (readOnly) {
          logger.log('')
          logger.log(
            'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.',
          )
        }
      } else {
        logger.log(`${key}: ${data}`)
        if (readOnly) {
          logger.log('')
          logger.log(
            'Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag.',
          )
        }
      }
      return ''
    },
  })
}
