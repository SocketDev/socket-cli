import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { OUTPUT_JSON } from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchResult(
  result: CResult<{ patched: string[] }>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { patched } = result.data

  logger.log('')

  if (patched.length) {
    logger.group(
      `Successfully processed patches for ${patched.length} ${pluralize('package', patched.length)}:`,
    )
    for (const pkg of patched) {
      logger.success(pkg)
    }
    logger.groupEnd()
  } else {
    logger.warn('No packages found requiring patches')
  }

  logger.log('')
  logger.success('Patch command completed!')
}
