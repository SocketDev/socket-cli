import { pluralize } from '@socketsecurity/registry/lib/words'

import constants from '../../constants'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { debugLog, isDebug } from '../../utils/debug'
import { getPackageFiles } from '../../utils/path-resolve'
import { setupSdk } from '../../utils/sdk'

import type { SocketYml } from '@socketsecurity/config'
import type {
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'

export async function createReport(
  socketConfig: SocketYml | undefined,
  inputPaths: Array<string>,
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
  const socketSdk = await setupSdk()
  const supportedFiles = await socketSdk
    .getReportSupportedFiles()
    .then(res => {
      if (!res.success)
        handleUnsuccessfulApiResponse('getReportSupportedFiles', res, spinner)
      return (res as SocketSdkReturnType<'getReportSupportedFiles'>).data
    })
    .catch((cause: Error) => {
      throw new Error('Failed getting supported files for report', {
        cause
      })
    })
  const packagePaths = await getPackageFiles(
    cwd,
    inputPaths,
    socketConfig,
    supportedFiles
  )
  const { length: packagePathsCount } = packagePaths
  if (packagePathsCount && isDebug()) {
    for (const pkgPath of packagePaths) {
      debugLog(`Uploading: ${pkgPath}`)
    }
  }
  if (dryRun) {
    debugLog('[dryRun] Skipped actual upload')
    return undefined
  }
  spinner.start(
    `Creating report with ${packagePathsCount} package ${pluralize('file', packagePathsCount)}`
  )
  const apiCall = socketSdk.createReportFromFilePaths(
    packagePaths,
    cwd,
    socketConfig?.issueRules
  )
  const result = await handleApiCall(apiCall, 'creating report')
  if (!result.success) {
    handleUnsuccessfulApiResponse('createReport', result, spinner)
    return undefined
  }
  spinner.successAndStop()
  return result
}
