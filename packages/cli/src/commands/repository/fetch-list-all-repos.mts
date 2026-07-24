import { handleApiCall } from '../../util/socket/api.mjs'
import { setupSdk } from '../../util/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../util/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'

export type FetchListAllReposOptions = {
  commandPath?: string | undefined
  direction?: string | undefined
  sdkOpts?: SetupSdkOptions | undefined
  sort?: string | undefined
}

export async function fetchListAllRepos(
  orgSlug: string,
  options?: FetchListAllReposOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<'listRepositories'>['data']>> {
  const { commandPath, direction, sdkOpts, sort } = {
    __proto__: null,
    ...options,
  } as FetchListAllReposOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const rows: SocketSdkSuccessResult<'listRepositories'>['data']['results'] = []
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
    const orgRepoListCResult = await handleApiCall<'listRepositories'>(
      sockSdk.listRepositories(orgSlug, {
        ...(sort ? { sort: sort } : {}),
        ...(direction ? { direction: direction } : {}),
        per_page: 100, // max
        page: nextPage,
      }),
      {
        commandPath,
        description: 'list of repositories',
      },
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
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- SDK schema uses `nextPage: string | null` for the GitHub-style pagination sentinel.
      nextPage: null,
    },
  }
}
