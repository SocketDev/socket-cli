// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputListScans(
  result: CResult<SocketSdkReturnType<'getOrgFullScanList'>['data']>,
  outputKind: OutputKind
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'report_url', name: colors.magenta('Scan URL') },
      { field: 'repo', name: colors.magenta('Repo') },
      { field: 'branch', name: colors.magenta('Branch') },
      { field: 'created_at', name: colors.magenta('Created at') }
    ]
  }

  const formattedResults = result.data.results.map(d => {
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
      repo: d.repo,
      branch: d.branch
    }
  })

  logger.log(chalkTable(options, formattedResults))
}
