import { logger } from '@socketsecurity/registry/lib/logger'

import { LocalConfig } from '../../utils/config'

export async function outputConfigAuto(
  key: keyof LocalConfig,
  success: boolean,
  value: unknown,
  message: string,
  outputKind: 'json' | 'markdown' | 'text'
) {
  if (outputKind === 'json') {
    logger.log(JSON.stringify({ success, message, result: { key, value } }))
  } else if (outputKind === 'markdown') {
    logger.log(`# Auto discover config value`)
    logger.log('')
    logger.log(
      `Attempted to automatically discover the value for config key: "${key}"`
    )
    logger.log('')
    if (success) {
      logger.log(`The discovered value is: "${value}"`)
    } else {
      logger.log(`The discovery failed: ${message}`)
    }
    logger.log('')
  } else {
    logger.log(`${key}: ${value}`)
  }
}
