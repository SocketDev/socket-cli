import { PackageData } from './get-package-info'
import constants from '../../constants'
import { getSeverityCount } from '../../utils/alert/severity'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { getPublicToken, setupSdk } from '../../utils/sdk'

export async function fetchPackageInfo(
  pkgName: string,
  pkgVersion: string,
  includeAllIssues: boolean
): Promise<void | PackageData> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(
    pkgVersion === 'latest'
      ? `Looking up data for the latest version of ${pkgName}`
      : `Looking up data for version ${pkgVersion} of ${pkgName}`
  )

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

  spinner?.successAndStop('Data fetched')

  return {
    data: result.data,
    severityCount,
    score: scoreResult.data
  }
}
