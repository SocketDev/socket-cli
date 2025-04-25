import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function outputConfigSet(
  key: keyof LocalConfig,
  _value: string,
  readOnly: boolean,
  outputKind: OutputKind
) {
  if (outputKind === 'json') {
    logger.log(
      JSON.stringify({
        success: true,
        message: `Config key '${key}' was updated${readOnly ? ' (Note: since at least one value was overridden from flag/env, the config was not persisted)' : ''}`,
        readOnly
      })
    )
  } else if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(`Config key '${key}' was updated`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: The change was not persisted because the config is in read-only mode,\n      meaning at least one key was temporarily overridden from an env var or\n      command flag.'
      )
    }
  } else {
    logger.log(`OK`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: The change was not persisted because the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag.'
      )
    }
  }
}
