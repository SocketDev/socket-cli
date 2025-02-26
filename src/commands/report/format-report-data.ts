import process from 'node:process'

import colors from 'yoctocolors-cjs'

import { ColorOrMarkdown } from '../../utils/color-or-markdown'

import type { ReportData } from './fetch-report-data'

export function formatReportDataOutput(
  reportId: string,
  data: ReportData,
  commandName: string,
  outputJson: boolean,
  outputMarkdown: boolean,
  strict: boolean
): void {
  if (outputJson) {
    console.log(JSON.stringify(data, undefined, 2))
  } else {
    const format = new ColorOrMarkdown(outputMarkdown)
    console.log(
      '\nDetailed info on socket.dev: ' +
        format.hyperlink(reportId, data.url, { fallbackToUrl: true })
    )
    if (!outputMarkdown) {
      console.log(
        colors.dim(
          `\nOr rerun ${colors.italic(commandName)} using the ${colors.italic('--json')} flag to get full JSON output`
        )
      )
    }
  }

  if (strict && !data.healthy) {
    process.exit(1)
  }
}
