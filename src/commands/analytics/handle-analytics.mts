import { fetchOrgAnalyticsData } from './fetch-org-analytics.mts'
import { fetchRepoAnalyticsData } from './fetch-repo-analytics.mts'
import { outputAnalytics } from './output-analytics.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type HandleAnalyticsConfig = {
  filepath: string
  outputKind: OutputKind
  repo: string
  scope: string
  time: number
}

export async function handleAnalytics({
  filepath,
  outputKind,
  repo,
  scope,
  time,
}: HandleAnalyticsConfig) {
  let result: CResult<
    | SocketSdkSuccessResult<'getOrgAnalytics'>['data']
    | SocketSdkSuccessResult<'getRepoAnalytics'>['data']
  >
  if (scope === 'org') {
    result = await fetchOrgAnalyticsData(time)
  } else if (repo) {
    result = await fetchRepoAnalyticsData(repo, time)
  } else {
    result = {
      ok: false,
      message: 'Missing repository name in command',
    }
  }
  if (result.ok && !result.data.length) {
    result = {
      ok: true,
      message: `The analytics data for this ${scope === 'org' ? 'organization' : 'repository'} is not yet available.`,
      data: [],
    }
  }

  await outputAnalytics(result, {
    filepath,
    outputKind,
    repo,
    scope,
    time,
  })
}
