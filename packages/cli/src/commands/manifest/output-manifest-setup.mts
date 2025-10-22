import { logger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'

import type { CResult } from '../../types.mts'

export async function outputManifestSetup(result: CResult<unknown>) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.success('Setup complete')
}
