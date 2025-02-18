import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api.ts'
import { debugLog } from '../../utils/debug.ts'
import { logSymbols } from '../../utils/logging.ts'
import { getPackageFiles } from '../../utils/path-resolve.ts'
import { setupSdk } from '../../utils/sdk.ts'

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
  const socketSdk = await setupSdk()
  const supportedFiles = await socketSdk
    .getReportSupportedFiles()
    .then(res => {
      if (!res.success)
        handleUnsuccessfulApiResponse(
          'getReportSupportedFiles',
          res,
          new Spinner()
        )
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

  debugLog('Uploading:', packagePaths.join(`\n${logSymbols.info} Uploading: `))

  if (dryRun) {
    debugLog('[dryRun] Skipped actual upload')
    return undefined
  } else {
    const socketSdk = await setupSdk()
    const spinner = new Spinner({
      text: `Creating report with ${packagePaths.length} package files`
    }).start()

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
    spinner.success()
    return result
  }
}
