import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { isConfigFromFlag } from '../../utils/config.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function outputConfigGet(
  key: keyof LocalConfig,
  result: CResult<LocalConfig[keyof LocalConfig]>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const readOnly = isConfigFromFlag()

  if (outputKind === 'markdown') {
    getDefaultLogger().log(mdHeader('Config Value'))
    getDefaultLogger().log('')
    getDefaultLogger().log(`Config key '${key}' has value '${result.data}`)
    if (readOnly) {
      getDefaultLogger().log('')
      getDefaultLogger().log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.',
      )
    }
  } else {
    getDefaultLogger().log(`${key}: ${result.data}`)
    if (readOnly) {
      getDefaultLogger().log('')
      getDefaultLogger().log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag.',
      )
    }
  }
}
