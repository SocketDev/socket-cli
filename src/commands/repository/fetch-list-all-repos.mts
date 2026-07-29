import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { RepositoriesListResult } from '@socketsecurity/sdk'

export type FetchListAllReposOptions = {
  direction?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
  sort?: string | undefined
}

export async function fetchListAllRepos(
  orgSlug: string,
  options?: FetchListAllReposOptions | undefined,
): Promise<CResult<RepositoriesListResult['data']>> {
  const { direction, sdkOpts, sort } = {
    __proto__: null,
    ...options,
  } as FetchListAllReposOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const rows: RepositoriesListResult['data']['results'] = []
  let protection = 0
  let nextPage = 0
  while (nextPage >= 0) {
    if (++protection > 100) {
      return {
        ok: false,
        message: 'Infinite loop detected',
        cause: `Either there are over 100 pages of results or the fetch has run into an infinite loop. Breaking it off now. nextPage=${nextPage}`,
      }
    }
    // eslint-disable-next-line no-await-in-loop
    const orgRepoListCResult = await handleApiCall(
      sockSdk.listRepositories(orgSlug, {
        ...(sort ? { sort: sort as 'name' | 'updated_at' | 'created_at' } : {}),
        ...(direction ? { direction: direction as 'asc' | 'desc' } : {}),
        per_page: 100, // max
        page: nextPage,
      }),
      { description: 'list of repositories' },
    )
    if (!orgRepoListCResult.ok) {
      return orgRepoListCResult
    }

    rows.push(...orgRepoListCResult.data.results)
    nextPage = orgRepoListCResult.data.nextPage ?? -1
  }

  return {
    ok: true,
    data: {
      results: rows,
      nextPage: null,
    },
  }
}
