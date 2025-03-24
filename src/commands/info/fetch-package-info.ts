import constants from '../../constants'
import { getSeverityCount } from '../../utils/alert/severity'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { getPublicToken, setupSdk } from '../../utils/sdk'

import type { PackageData } from './handle-package-info'

export async function fetchPackageInfo(
  pkgName: string,
  pkgVersion: string,
  includeAllIssues: boolean
): Promise<void | PackageData> {
  const sockSdk = await setupSdk(getPublicToken())

  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(
    pkgVersion === 'latest'
      ? `Looking up data for the latest version of ${pkgName}`
      : `Looking up data for version ${pkgVersion} of ${pkgName}`
  )

  const result = await handleApiCall(
    sockSdk.getIssuesByNPMPackage(pkgName, pkgVersion),
    'looking up package'
  )
  const scoreResult = await handleApiCall(
    sockSdk.getScoreByNPMPackage(pkgName, pkgVersion),
    'looking up package score'
  )

  spinner.successAndStop('Data fetched')

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
