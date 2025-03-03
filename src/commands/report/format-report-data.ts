import process from 'node:process'

import { stripIndents } from 'common-tags'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

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
    logger.log(JSON.stringify(data, undefined, 2))
  } else {
    const format = new ColorOrMarkdown(outputMarkdown)
    logger.log(stripIndents`
      Detailed info on socket.dev: ${format.hyperlink(reportId, data.url, {
        fallbackToUrl: true
      })}`)
    if (!outputMarkdown) {
      logger.log(
        colors.dim(
          `Or rerun ${colors.italic(commandName)} using the ${colors.italic('--json')} flag to get full JSON output`
        )
      )
    }
  }

  if (strict && !data.healthy) {
    process.exit(1)
  }
}
