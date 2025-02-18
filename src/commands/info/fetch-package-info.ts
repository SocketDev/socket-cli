import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { PackageData } from './get-package-info.ts'
import { getSeverityCount } from '../../utils/alert/severity.ts'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api.ts'
import { getPublicToken, setupSdk } from '../../utils/sdk.ts'

export async function fetchPackageInfo(
  pkgName: string,
  pkgVersion: string,
  includeAllIssues: boolean,
  spinner: Spinner
): Promise<void | PackageData> {
  const socketSdk = await setupSdk(getPublicToken())
  const result = await handleApiCall(
    socketSdk.getIssuesByNPMPackage(pkgName, pkgVersion),
    'looking up package'
  )
  const scoreResult = await handleApiCall(
    socketSdk.getScoreByNPMPackage(pkgName, pkgVersion),
    'looking up package score'
  )

  if (result.success === false) {
    return handleUnsuccessfulApiResponse(
      'getIssuesByNPMPackage',
      result,
      spinner
    )
  }

  if (scoreResult.success === false) {
    return handleUnsuccessfulApiResponse(
      'getScoreByNPMPackage',
      scoreResult,
      spinner
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
