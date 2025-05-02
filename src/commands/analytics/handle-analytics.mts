import { fetchOrgAnalyticsData } from './fetch-org-analytics.mts'
import { fetchRepoAnalyticsData } from './fetch-repo-analytics.mts'
import { outputAnalytics } from './output-analytics.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function handleAnalytics({
  filePath,
  outputKind,
  repo,
  scope,
  time
}: {
  scope: string
  time: number
  repo: string
  outputKind: OutputKind
  filePath: string
}) {
  let result: CResult<
    | SocketSdkReturnType<'getOrgAnalytics'>['data']
    | SocketSdkReturnType<'getRepoAnalytics'>['data']
  >
  if (scope === 'org') {
    result = await fetchOrgAnalyticsData(time)
  } else if (repo) {
    result = await fetchRepoAnalyticsData(repo, time)
  } else {
    result = {
      ok: false,
      message: 'Missing repository name in command'
    }
  }
  if (result.ok && !result.data.length) {
    result = {
      ok: true,
      message: `The analytics data for this ${scope === 'org' ? 'organization' : 'repository'} is not yet available.`,
      data: []
    }
  }

  await outputAnalytics(result, {
    filePath,
    outputKind,
    repo,
    scope,
    time
  })
}
