import { logger } from '@socketsecurity/lib/logger'
import type { CResult } from '../../types.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

export interface WhoamiStatus {
  authenticated: boolean
  token: string | null
  location: string | null
}

export function outputWhoami(status: WhoamiStatus): void {
  const result: CResult<WhoamiStatus> = {
    ok: true,
    data: status,
  }
  logger.log(serializeResultJson(result))
}
