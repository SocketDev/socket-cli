import { logger } from '@socketsecurity/registry/lib/logger'

import type { LocalConfig } from '../../utils/config'

export async function outputConfigSet(
  key: keyof LocalConfig,
  _value: string,
  outputKind: 'json' | 'markdown' | 'text'
) {
  if (outputKind === 'json') {
    logger.log(
      JSON.stringify({
        success: true,
        message: `Config key '${key}' was updated`
      })
    )
  } else if (outputKind === 'markdown') {
    logger.log(`# Update config`)
    logger.log('')
    logger.log(`Config key '${key}' was updated`)
  } else {
    logger.log(`OK`)
  }
}
