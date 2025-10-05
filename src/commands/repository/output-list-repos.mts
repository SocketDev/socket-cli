/** @fileoverview Repository list output formatter for Socket CLI. Displays paginated repository listings in JSON or table formats. Shows repository ID, name, visibility, default branch, and archived status with pagination hints. */

// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'
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
  outputResult(result, outputKind, {
    json: res => {
      if (res.ok) {
        return serializeResultJson({
          ok: true,
          data: {
            data: res.data,
            direction,
            nextPage: nextPage ?? 0,
            page,
            perPage,
            sort,
          },
        })
      }
      return serializeResultJson(res)
    },
    success: data => {
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

      logger.log(chalkTable(options, data.results))
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
      return ''
    },
  })
}
