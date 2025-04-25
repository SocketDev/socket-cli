import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function outputConfigUnset(
  key: keyof LocalConfig,
  outputKind: OutputKind
) {
  if (outputKind === 'json') {
    logger.log(
      JSON.stringify({
        success: true,
        message: `Config key '${key}' was unset`
      })
    )
  } else if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(`Config key '${key}' was unset`)
  } else {
    logger.log(`OK`)
  }
}
