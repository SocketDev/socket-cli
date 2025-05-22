import { debugLog } from '@socketsecurity/registry/lib/debug'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function fetchListAllRepos({
  direction,
  orgSlug,
  sort,
}: {
  direction: string
  orgSlug: string
  sort: string
}): Promise<CResult<SocketSdkReturnType<'getOrgRepoList'>['data']>> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  const rows: SocketSdkReturnType<'getOrgRepoList'>['data']['results'] = []
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
    const result = await handleApiCall(
      sockSdk.getOrgRepoList(orgSlug, {
        sort,
        direction,
        per_page: String(100), // max
        page: String(nextPage),
      }),
      'list of repositories',
    )
    if (!result.ok) {
      debugLog(
        '[DEBUG] fetchListAllRepos: At least one fetch failed, bailing...',
      )
      debugLog(result)
      return result
    }

    result.data.results.forEach(row => rows.push(row))
    nextPage = result.data.nextPage ?? -1
  }

  return {
    ok: true,
    data: {
      results: rows,
      nextPage: null,
    },
  }
}
