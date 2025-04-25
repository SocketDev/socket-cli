// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputListRepos(
  data: SocketSdkReturnType<'getOrgRepoList'>['data'],
  outputKind: OutputKind
): Promise<void> {
  if (outputKind === 'json') {
    const json = data.results.map(o => ({
      id: o.id,
      name: o.name,
      visibility: o.visibility,
      defaultBranch: o.default_branch,
      archived: o.archived
    }))
    logger.log(JSON.stringify(json, null, 2))
    return
  }

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'archived', name: colors.magenta('Archived') }
    ]
  }

  logger.log(chalkTable(options, data.results))
}
