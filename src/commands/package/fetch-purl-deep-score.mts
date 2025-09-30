import { logger } from '@socketsecurity/registry/lib/logger'

import { queryApiJson, setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

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
  options?: { sdkOpts?: SetupSdkOptions | undefined } | undefined,
): Promise<CResult<PurlDataResponse>> {
  logger.info(`Requesting deep score data for this purl: ${purl}`)

  const { sdkOpts } = { ...options }
  const sdkResult = await setupSdk(sdkOpts)
  if (!sdkResult.ok) {
    return sdkResult
  }

  const sdk = sdkResult.data
  const result = await queryApiJson<PurlDataResponse>(
    sdk,
    `purl/score/${encodeURIComponent(purl)}`,
    {
      throws: false,
      description: 'the deep package scores',
    },
  )

  // The SDK returns a CResult which matches our expected return type
  return result as CResult<PurlDataResponse>
}
