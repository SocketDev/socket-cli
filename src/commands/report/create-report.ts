import { debugLog, isDebug } from '@socketsecurity/registry/lib/debug'
import { pluralize } from '@socketsecurity/registry/lib/words'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { getPackageFilesForScan } from '../../utils/path-resolve'
import { setupSdk } from '../../utils/sdk'

import type { SocketYml } from '@socketsecurity/config'
import type {
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'

const { DRY_RUN_LABEL } = constants

export async function createReport(
  socketConfig: SocketYml | undefined,
  inputPaths: string[],
  {
    cwd,
    dryRun
  }: {
    cwd: string
    dryRun: boolean
  }
): Promise<undefined | SocketSdkResultType<'createReport'>> {
  // Lazily access constants.spinner.
  const { spinner } = constants
  const sockSdk = await setupSdk()
  const supportedFiles = await sockSdk
    .getReportSupportedFiles()
    .then(res => {
      if (!res.success) {
        handleUnsuccessfulApiResponse('getReportSupportedFiles', res)
      }
      return (res as SocketSdkReturnType<'getReportSupportedFiles'>).data
    })
    .catch((cause: Error) => {
      throw new Error('Failed getting supported files for report', {
        cause
      })
    })
  const packagePaths = await getPackageFilesForScan(
    cwd,
    inputPaths,
    supportedFiles,
    socketConfig
  )
  const packagePathsCount = packagePaths.length
  if (packagePathsCount && isDebug()) {
    for (const pkgPath of packagePaths) {
      debugLog(`Uploading: ${pkgPath}`)
    }
  }
  if (dryRun) {
    debugLog(`${DRY_RUN_LABEL}: Skipped actual upload`)
    return undefined
  }
  spinner.start(
    `Creating report with ${packagePathsCount} package ${pluralize('file', packagePathsCount)}`
  )
  const apiCall = sockSdk.createReportFromFilePaths(
    packagePaths,
    cwd,
    socketConfig?.issueRules
  )
  const result = await handleApiCall(apiCall, 'creating report')
  if (!result.success) {
    handleUnsuccessfulApiResponse('createReport', result)
    return undefined
  }
  spinner.successAndStop()
  return result
}
