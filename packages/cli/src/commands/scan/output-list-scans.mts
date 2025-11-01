import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type ScanListItem =
  SocketSdkSuccessResult<'listFullScans'>['data']['results'][number]

export async function outputListScans(
  result: CResult<SocketSdkSuccessResult<'listFullScans'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'report_url', name: colors.magenta('Scan URL') },
      { field: 'repo', name: colors.magenta('Repo') },
      { field: 'branch', name: colors.magenta('Branch') },
      { field: 'created_at', name: colors.magenta('Created at') },
    ],
  }

  const formattedResults = result.data.results.map((d: ScanListItem) => {
    return {
      id: d.id,
      report_url: colors.underline(`${d.html_report_url}`),
      created_at: d.created_at
        ? new Date(d.created_at).toLocaleDateString('en-us', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
          })
        : '',
      repo: d.repo,
      branch: d.branch,
    }
  })

  getDefaultLogger().log(chalkTable(options, formattedResults))
}
