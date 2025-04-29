import { logger } from '@socketsecurity/registry/lib/logger'

import { LocalConfig, isReadOnlyConfig } from '../../utils/config'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { serializeResultJson } from '../../utils/serialize-result-json'

import type { CResult, OutputKind } from '../../types'

export async function outputConfigGet(
  key: keyof LocalConfig,
  result: CResult<LocalConfig[keyof LocalConfig]>,
  outputKind: OutputKind
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const readOnly = isReadOnlyConfig()

  if (outputKind === 'markdown') {
    logger.log(`# Config Value`)
    logger.log('')
    logger.log(`Config key '${key}' has value '${result.data}`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.'
      )
    }
  } else {
    logger.log(`${key}: ${result.data}`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag.'
      )
    }
  }
}
