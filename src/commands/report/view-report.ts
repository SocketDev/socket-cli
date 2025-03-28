import { fetchReportData } from './fetch-report-data'
import { formatReportDataOutput } from './format-report-data'
import { fetchScan } from '../scan/fetch-scan'

import type { components } from '@socketsecurity/sdk/types/api'

export async function viewReport(
  reportId: string,
  {
    all,
    commandName,
    outputKind,
    strict
  }: {
    commandName: string
    all: boolean
    outputKind: 'json' | 'markdown' | 'print'
    strict: boolean
  }
) {
  const result = await fetchReportData(reportId, all, strict)

  const artifacts: Array<components['schemas']['SocketArtifact']> | undefined =
    await fetchScan('socketdev', reportId)

  if (result) {
    formatReportDataOutput(
      reportId,
      result,
      commandName,
      outputKind,
      strict,
      artifacts
    )
  }
}
