/** @fileoverview Repository view output formatter for Socket CLI. Displays repository integration details in JSON or table formats. Shows repository ID, name, visibility, default branch, homepage, archived status, and creation date. */

// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputViewRepo(
  result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: data => {
      const options = {
        columns: [
          { field: 'id', name: colors.magenta('ID') },
          { field: 'name', name: colors.magenta('Name') },
          { field: 'visibility', name: colors.magenta('Visibility') },
          { field: 'default_branch', name: colors.magenta('Default branch') },
          { field: 'homepage', name: colors.magenta('Homepage') },
          { field: 'archived', name: colors.magenta('Archived') },
          { field: 'created_at', name: colors.magenta('Created at') },
        ],
      }
      return chalkTable(options, [data])
    },
  })
}
