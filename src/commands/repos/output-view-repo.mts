// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputViewRepo(
  result: CResult<SocketSdkReturnType<'createOrgRepo'>['data']>,
  outputKind: OutputKind,
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
      { field: 'name', name: colors.magenta('Name') },
      { field: 'visibility', name: colors.magenta('Visibility') },
      { field: 'default_branch', name: colors.magenta('Default branch') },
      { field: 'homepage', name: colors.magenta('Homepage') },
      { field: 'archived', name: colors.magenta('Archived') },
      { field: 'created_at', name: colors.magenta('Created at') },
    ],
  }

  logger.log(chalkTable(options, [result.data]))
}
