import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { Direction } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputListRepos(
  result: CResult<SocketSdkSuccessResult<'listRepositories'>['data']>,
  outputKind: OutputKind,
  page: number,
  nextPage: number | null,
  sort: string,
  perPage: number,
  direction: Direction,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    if (result.ok) {
      getDefaultLogger().log(
        serializeResultJson({
          ok: true,
          data: {
            data: result.data,
            direction,
            nextPage: nextPage ?? 0,
            page,
            perPage,
            sort,
          },
        }),
      )
    } else {
      getDefaultLogger().log(serializeResultJson(result))
    }
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  getDefaultLogger().log(
    `Result page: ${page}, results per page: ${perPage === Number.POSITIVE_INFINITY ? 'all' : perPage}, sorted by: ${sort}, direction: ${direction}`,
  )

  const options = {
    columns: [
      { field: 'id', name: colors.magenta('ID') },
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'archived', name: colors.magenta('Archived') },
    ],
  }

  getDefaultLogger().log(chalkTable(options, result.data.results))
  if (nextPage) {
    getDefaultLogger().info(
      `This is page ${page}. Server indicated there are more results available on page ${nextPage}...`,
    )
    getDefaultLogger().info(
      `(Hint: you can use \`socket repository list --page ${nextPage}\`)`,
    )
  } else if (perPage === Number.POSITIVE_INFINITY) {
    getDefaultLogger().info(
      'This should be the entire list available on the server.',
    )
  } else {
    getDefaultLogger().info(
      `This is page ${page}. Server indicated this is the last page with results.`,
    )
  }
}
