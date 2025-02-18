import { fetchReportData } from './fetch-report-data.ts'
import { formatReportDataOutput } from './format-report-data.ts'

export async function viewReport(
  reportId: string,
  {
    all,
    commandName,
    json,
    markdown,
    strict
  }: {
    commandName: string
    all: boolean
    json: boolean
    markdown: boolean
    strict: boolean
  }
) {
  const result = await fetchReportData(reportId, all, strict)
  if (result) {
    formatReportDataOutput(
      reportId,
      result,
      commandName,
      json,
      markdown,
      strict
    )
  }
}
