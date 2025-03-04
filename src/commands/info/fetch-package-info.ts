import { PackageData } from './get-package-info'
import { getSeverityCount } from '../../utils/alert/severity'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { getPublicToken, setupSdk } from '../../utils/sdk'

export async function fetchPackageInfo(
  pkgName: string,
  pkgVersion: string,
  includeAllIssues: boolean
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
    return handleUnsuccessfulApiResponse('getIssuesByNPMPackage', result)
  }

  if (scoreResult.success === false) {
    return handleUnsuccessfulApiResponse('getScoreByNPMPackage', scoreResult)
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
