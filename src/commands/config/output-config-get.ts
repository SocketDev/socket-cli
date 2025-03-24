import { logger } from '@socketsecurity/registry/lib/logger'

import { LocalConfig } from '../../utils/config'

export async function outputConfigGet(
  key: keyof LocalConfig,
  value: unknown,
  outputKind: 'json' | 'markdown' | 'text'
) {
  if (outputKind === 'json') {
    logger.log(JSON.stringify({ success: true, result: { key, value } }))
  } else if (outputKind === 'markdown') {
    logger.log(`# Config Value`)
    logger.log('')
    logger.log(`Config key '${key}' has value '${value}`)
  } else {
    logger.log(`${key}: ${value}`)
  }
}
