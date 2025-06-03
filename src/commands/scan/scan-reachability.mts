import { logger } from '@socketsecurity/registry/lib/logger'

import type { CResult } from '../../types.mts'

export async function scanReachability(cwd: string): Promise<CResult<unknown>> {
  logger.log('Scanning now... as soon as you implement me! From', cwd)

  return { ok: true, data: undefined }
}
