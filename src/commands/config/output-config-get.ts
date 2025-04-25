import { logger } from '@socketsecurity/registry/lib/logger'

import { LocalConfig } from '../../utils/config'

import type { OutputKind } from '../../types'

export async function outputConfigGet(
  key: keyof LocalConfig,
  value: unknown,
  readOnly: boolean, // Is config in read-only mode? (Overrides applied)
  outputKind: OutputKind
) {
  if (outputKind === 'json') {
    logger.log(
      JSON.stringify({ success: true, result: { key, value }, readOnly })
    )
  } else if (outputKind === 'markdown') {
    logger.log(`# Config Value`)
    logger.log('')
    logger.log(`Config key '${key}' has value '${value}`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.'
      )
    }
  } else {
    logger.log(`${key}: ${value}`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag.'
      )
    }
  }
}
