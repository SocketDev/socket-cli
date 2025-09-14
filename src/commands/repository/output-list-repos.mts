// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { Direction } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputListRepos(
  result: CResult<SocketSdkSuccessResult<'getOrgRepoList'>['data']>,
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
      logger.log(
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
      logger.log(serializeResultJson(result))
    }
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.log(
    `Result page: ${page}, results per page: ${perPage === Infinity ? 'all' : perPage}, sorted by: ${sort}, direction: ${direction}`,
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

  logger.log(chalkTable(options, result.data.results))
  if (nextPage) {
    logger.info(
      `This is page ${page}. Server indicated there are more results available on page ${nextPage}...`,
    )
    logger.info(
      `(Hint: you can use \`socket repository list --page ${nextPage}\`)`,
    )
  } else if (perPage === Infinity) {
    logger.info(`This should be the entire list available on the server.`)
  } else {
    logger.info(
      `This is page ${page}. Server indicated this is the last page with results.`,
    )
  }
}
