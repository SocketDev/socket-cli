import { Spinner } from '@socketsecurity/registry/lib/spinner'

import {
  formatSeverityCount,
  getSeverityCount
} from '../../utils/alert/severity'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type {
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'

export type ReportData = SocketSdkReturnType<'getReport'>['data']

const MAX_TIMEOUT_RETRY = 5
const HTTP_CODE_TIMEOUT = 524

export async function fetchReportData(
  reportId: string,
  includeAllIssues: boolean,
  strict: boolean
): Promise<void | ReportData> {
  const socketSdk = await setupSdk()
  const spinner = new Spinner({
    text: `Fetching report with ID ${reportId} (this could take a while)`
  }).start()

  let result: SocketSdkResultType<'getReport'> | undefined
  for (let retry = 1; !result; ++retry) {
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await handleApiCall(
        socketSdk.getReport(reportId),
        'fetching report'
      )
    } catch (err) {
      if (
        retry >= MAX_TIMEOUT_RETRY ||
        !(err instanceof Error) ||
        (err.cause as any)?.cause?.response?.statusCode !== HTTP_CODE_TIMEOUT
      ) {
        throw err
      }
    }
  }

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getReport', result, spinner)
  }

  // Conclude the status of the API call

  if (strict) {
    if (result.data.healthy) {
      spinner.successAndStop('Report result is healthy and great!')
    } else {
      spinner.errorAndStop('Report result deemed unhealthy for project')
    }
  } else if (!result.data.healthy) {
    const severityCount = getSeverityCount(
      result.data.issues,
      includeAllIssues ? undefined : 'high'
    )
    const issueSummary = formatSeverityCount(severityCount)
    spinner.successAndStop(`Report has these issues: ${issueSummary}`)
  } else {
    spinner.successAndStop('Report has no issues')
  }

  return result.data
}
