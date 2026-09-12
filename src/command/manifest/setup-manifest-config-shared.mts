import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { CResult } from '../../types.mts'

const logger = getDefaultLogger()

export function canceledByUser(): CResult<{ canceled: boolean }> {
  logger.log('')
  logger.info('User canceled')
  logger.log('')
  return { ok: true, data: { canceled: true } }
}

export function notCanceled(): CResult<{ canceled: boolean }> {
  return { ok: true, data: { canceled: false } }
}
