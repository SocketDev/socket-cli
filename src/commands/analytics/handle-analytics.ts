import { fetchOrgAnalyticsData } from './fetch-org-analytics'
import { fetchRepoAnalyticsData } from './fetch-repo-analytics'
import { outputAnalytics } from './output-analytics.ts'

import type { CliJsonResult, OutputKind } from '../../types'
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
  let result: CliJsonResult<
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
      message: 'Missing repository name in command',
      data: undefined
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
