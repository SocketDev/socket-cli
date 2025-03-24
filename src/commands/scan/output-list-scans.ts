// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputListScans(
  data: SocketSdkReturnType<'getOrgFullScanList'>['data'],
  outputKind: 'json' | 'markdown' | 'print'
): Promise<void> {
  if (outputKind === 'json') {
    logger.log(data)
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'report_url', name: colors.magenta('Scan URL') },
      { field: 'branch', name: colors.magenta('Branch') },
      { field: 'created_at', name: colors.magenta('Created at') }
    ]
  }

  const formattedResults = data.results.map(d => {
    return {
      id: d.id,
      report_url: colors.underline(`${d.html_report_url}`),
      created_at: d.created_at
        ? new Date(d.created_at).toLocaleDateString('en-us', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
          })
        : '',
      branch: d.branch
    }
  })

  logger.log(chalkTable(options, formattedResults))
}
