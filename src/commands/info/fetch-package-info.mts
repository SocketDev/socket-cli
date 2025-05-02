import { getSeverityCount } from '../../utils/alert/severity.mts'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api.mts'
import { getPublicToken, setupSdk } from '../../utils/sdk.mts'

import type { PackageData } from './handle-package-info.mts'

export async function fetchPackageInfo(
  pkgName: string,
  pkgVersion: string,
  includeAllIssues: boolean
): Promise<void | PackageData> {
  const sockSdk = await setupSdk(getPublicToken())

  const result = await handleApiCall(
    sockSdk.getIssuesByNPMPackage(pkgName, pkgVersion),
    'Requesting package issues...',
    'Received API response (requested package issues).',
    'Error fetching package issues',
    'getIssuesByNPMPackage'
  )
  const scoreResult = await handleApiCall(
    sockSdk.getScoreByNPMPackage(pkgName, pkgVersion),
    'looking up package score',
    'Received API response (requested package score).',
    'Error fetching package score',
    'getScoreByNPMPackage'
  )

  if (!result.ok) {
    handleUnsuccessfulApiResponse(
      'getIssuesByNPMPackage',
      result.message,
      result.cause ?? '',
      (result.data as any)?.code ?? 0
    )
  }

  if (!scoreResult.ok) {
    handleUnsuccessfulApiResponse(
      'getScoreByNPMPackage',
      scoreResult.message,
      scoreResult.cause ?? '',
      (scoreResult.data as any)?.code ?? 0
    )
  }

  const severityCount = getSeverityCount(
    result.data,
    includeAllIssues ? undefined : 'high'
  )

  return {
    data: result.data,
    severityCount,
    score: scoreResult.data
  }
}
