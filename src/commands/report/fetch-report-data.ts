import constants from '../../constants'
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
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start(`Fetching report with ID ${reportId} (this could take a while)`)

  const socketSdk = await setupSdk()
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
        spinner.stop()
        throw err
      }
    }
  }

  if (!result.success) {
    return handleUnsuccessfulApiResponse('getReport', result)
  }

  // Conclude the status of the API call.
  if (strict) {
    if (result.data.healthy) {
      spinner.success('Report result is healthy and great!')
    } else {
      spinner.error('Report result deemed unhealthy for project')
    }
  } else if (!result.data.healthy) {
    const severityCount = getSeverityCount(
      result.data.issues,
      includeAllIssues ? undefined : 'high'
    )
    const issueSummary = formatSeverityCount(severityCount)
    spinner.success(`Report has these issues: ${issueSummary}`)
  } else {
    spinner.success('Report has no issues')
  }
  spinner.stop()

  return result.data
}
