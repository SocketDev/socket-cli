/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isConfigFromFlag } from '../../util/config.mts'
import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../util/config.mts'
const logger = getDefaultLogger()

export async function outputConfigGet(
  key: keyof LocalConfig,
  result: CResult<LocalConfig[keyof LocalConfig]>,
  outputKind: OutputKind,
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

  const readOnly = isConfigFromFlag()

  if (outputKind === 'markdown') {
    logger.log(mdHeader('Config Value'))
    logger.log('')
    logger.log(`Config key '${key}' has value '${String(result.data)}`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.',
      )
    }
  } else {
    logger.log(`${key}: ${String(result.data)}`)
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag.',
      )
    }
  }
}
