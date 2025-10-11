import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

export type FetchDependenciesOptions = {
  limit?: number | undefined
  offset?: number | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

// Type expected by output modules
export interface DependenciesResult {
  dependencies: Array<{
    name: string
    version?: string | undefined
    ecosystem: string
    directDependency: boolean
    repository?: string | undefined
  }>
  total: number
}

export async function fetchDependencies(
  // Not used by searchDependencies API
  _orgSlug: string,
  options?: FetchDependenciesOptions | undefined,
): Promise<CResult<DependenciesResult>> {
  const { limit = 100, offset = 0, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchDependenciesOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  // Note: The API doesn't actually use orgSlug for searchDependencies
  // It searches across all accessible organizations
  const apiResult = await handleApiCall(sockSdk.searchDependencies({ limit, offset }), {
    description: 'organization dependencies',
  })

  if (!apiResult.ok) {
    return apiResult
  }

  // Transform API response to expected format
  const transformed: DependenciesResult = {
    dependencies: apiResult.data.rows.map(row => ({
      name: row.name,
      version: row.version,
      // API uses 'type', output expects 'ecosystem'
      ecosystem: row.type,
      // API uses 'direct', output expects 'directDependency'
      directDependency: row.direct,
      repository: row.repository,
    })),
    total: apiResult.data.rows.length,
  }

  return {
    ok: true,
    data: transformed,
  }
}