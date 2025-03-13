import { components } from '@socketsecurity/sdk/types/api'

import { fetchReportData } from './fetch-report-data'
import { formatReportDataOutput } from './format-report-data'
import { getFullScan } from '../scan/get-full-scan'

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
    await getFullScan('socketdev', reportId)

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
