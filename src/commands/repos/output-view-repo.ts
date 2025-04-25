// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputViewRepo(
  data: SocketSdkReturnType<'createOrgRepo'>['data'],
  outputKind: OutputKind
): Promise<void> {
  if (outputKind === 'json') {
    const {
      archived,
      created_at,
      default_branch,
      homepage,
      id,
      name,
      visibility
    } = data
    logger.log(
      JSON.stringify(
        {
          id,
          name,
          visibility,
          default_branch,
          homepage,
          archived,
          created_at
        },
        null,
        2
      )
    )
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'homepage', name: colors.magenta('Homepage') },
      { field: 'archived', name: colors.magenta('Archived') },
      { field: 'created_at', name: colors.magenta('Created at') }
    ]
  }

  logger.log(chalkTable(options, [data]))
}
