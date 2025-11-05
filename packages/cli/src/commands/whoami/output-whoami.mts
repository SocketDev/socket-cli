import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'

import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult } from '../../types.mts'

const logger = getDefaultLogger()

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
