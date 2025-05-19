import { logger } from '@socketsecurity/registry/lib/logger'

import { queryApiSafeJson } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'

export interface PurlDataResponse {
  purl: string
  self: {
    purl: string
    score: {
      license: number
      maintenance: number
      overall: number
      quality: number
      supplyChain: number
      vulnerability: number
    }
    capabilities: string[]
    alerts: Array<{
      name: string
      severity: string
      category: string
      example: string
    }>
  }
  transitively: {
    dependencyCount: number
    func: string
    score: {
      license: number
      maintenance: number
      overall: number
      quality: number
      supplyChain: number
      vulnerability: number
    }
    lowest: {
      license: string
      maintenance: string
      overall: string
      quality: string
      supplyChain: string
      vulnerability: string
    }
    capabilities: string[]
    alerts: Array<{
      name: string
      severity: string
      category: string
      example: string
    }>
  }
}

export async function fetchPurlDeepScore(
  purl: string,
): Promise<CResult<PurlDataResponse>> {
  logger.error(`Requesting deep score data for this purl: ${purl}`)

  return await queryApiSafeJson<PurlDataResponse>(
    `purl/score/${encodeURIComponent(purl)}`,
    'the deep package scores',
  )
}
