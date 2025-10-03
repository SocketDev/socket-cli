/** @fileoverview Whoami output formatter for Socket CLI. Displays authentication status in JSON or text formats. Shows logged-in user information or authentication errors. */

import { logger } from '@socketsecurity/registry/lib/logger'

import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult } from '../../types.mts'

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
