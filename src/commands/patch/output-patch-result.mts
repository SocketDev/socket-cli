import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchResult(
  result: CResult<{ patchedPackages: string[] }>,
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

  const { patchedPackages } = result.data

  if (patchedPackages.length > 0) {
    logger.success(
      `Successfully processed patches for ${patchedPackages.length} package(s):`,
    )
    for (const pkg of patchedPackages) {
      logger.success(pkg)
    }
  } else {
    logger.info('No packages found requiring patches')
  }

  logger.log('')
  logger.success('Patch command completed!')
}
