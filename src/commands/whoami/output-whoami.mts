import { logger } from '@socketsecurity/registry/lib/logger'

export interface WhoamiStatus {
  authenticated: boolean
  token: string | null
  location: string | null
}

export function outputWhoami(status: WhoamiStatus): void {
  logger.json(status)
}
