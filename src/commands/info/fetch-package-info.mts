import { getSeverityCount } from '../../utils/alert/severity.mts'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse,
} from '../../utils/api.mts'
import { getPublicToken, setupSdk } from '../../utils/sdk.mts'

import type { PackageData } from './handle-package-info.mts'

export async function fetchPackageInfo(
  pkgName: string,
  pkgVersion: string,
  includeAllIssues: boolean,
): Promise<void | PackageData> {
  const sockSdkResult = await setupSdk(getPublicToken())
  if (!sockSdkResult.ok) {
    throw new Error('Was unable to setup sdk. Run `socket login` first.')
  }
  const sockSdk = sockSdkResult.data

  const result = await handleApiCall(
    sockSdk.getIssuesByNPMPackage(pkgName, pkgVersion),
    'package issues',
  )
  const scoreResult = await handleApiCall(
    sockSdk.getScoreByNPMPackage(pkgName, pkgVersion),
    'package score',
  )

  if (!result.ok) {
    handleUnsuccessfulApiResponse(
      'getIssuesByNPMPackage',
      result.message,
      result.cause ?? '',
      (result.data as any)?.code ?? 0,
    )
  }

  if (!scoreResult.ok) {
    handleUnsuccessfulApiResponse(
      'getScoreByNPMPackage',
      scoreResult.message,
      scoreResult.cause ?? '',
      (scoreResult.data as any)?.code ?? 0,
    )
  }

  const severityCount = getSeverityCount(
    result.data,
    includeAllIssues ? undefined : 'high',
  )

  return {
    data: result.data,
    severityCount,
    score: scoreResult.data,
  }
}
