// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputDependencies(
  result: CResult<SocketSdkReturnType<'searchDependencies'>['data']>,
  {
    limit,
    offset,
    outputKind
  }: {
    limit: number
    offset: number
    outputKind: OutputKind
  }
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

  logger.log(
    'Request details: Offset:',
    offset,
    ', limit:',
    limit,
    ', is there more data after this?',
    result.data.end ? 'no' : 'yes'
  )

  const options = {
    columns: [
      { field: 'namespace', name: colors.cyan('Namespace') },
      { field: 'name', name: colors.cyan('Name') },
      { field: 'version', name: colors.cyan('Version') },
      { field: 'repository', name: colors.cyan('Repository') },
      { field: 'branch', name: colors.cyan('Branch') },
      { field: 'type', name: colors.cyan('Type') },
      { field: 'direct', name: colors.cyan('Direct') }
    ]
  }

  logger.log(chalkTable(options, result.data.rows))
}
