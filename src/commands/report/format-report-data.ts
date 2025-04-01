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
  outputKind: 'json' | 'markdown' | 'print',
  strict: boolean,
  artifacts: any
): void {
  if (outputKind === 'json') {
    logger.log(JSON.stringify(data, undefined, 2))
  } else {
    const format = new ColorOrMarkdown(outputKind === 'markdown')
    logger.log(stripIndents`
      Detailed info on socket.dev: ${format.hyperlink(reportId, data.url, {
        fallbackToUrl: true
      })}`)
    if (outputKind === 'print') {
      logger.log(data)
      logger.log(
        colors.dim(
          `Or rerun ${colors.italic(commandName)} using the ${colors.italic('--json')} flag to get full JSON output`
        )
      )
      logger.log('The scan:')
      logger.log(artifacts)
    }
  }

  if (strict && !data.healthy) {
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  }
}
