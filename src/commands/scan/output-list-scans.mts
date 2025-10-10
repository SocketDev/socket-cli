/** @fileoverview Scan list output formatter for Socket CLI. Displays paginated scan listings in JSON or table formats. Shows scan IDs, repositories, branches, default branches, commit information, and creation timestamps with pagination hints. */

import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputListScans(
  result: CResult<SocketSdkSuccessResult<'getOrgFullScanList'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: data => {
      const options = {
        columns: [
          { field: 'id', name: colors.magenta('ID') },
          { field: 'report_url', name: colors.magenta('Scan URL') },
          { field: 'repo', name: colors.magenta('Repo') },
          { field: 'branch', name: colors.magenta('Branch') },
          { field: 'created_at', name: colors.magenta('Created at') },
        ],
      }

      const formattedResults = data.results.map(d => {
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

      logger.log(chalkTable({ ...options, rows: formattedResults }))
      return ''
    },
  })
}
