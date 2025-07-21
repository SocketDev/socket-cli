// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputDependencies(
  result: CResult<SocketSdkSuccessResult<'searchDependencies'>['data']>,
  {
    limit,
    offset,
    outputKind,
  }: {
    limit: number
    offset: number
    outputKind: OutputKind
  },
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

  outputMarkdown(result.data, { limit, offset })
}

function outputMarkdown(
  result: SocketSdkSuccessResult<'searchDependencies'>['data'],
  {
    limit,
    offset,
  }: {
    limit: number
    offset: number
  },
) {
  logger.log('# Organization dependencies')
  logger.log('')
  logger.log('Request details:')
  logger.log('- Offset:', offset)
  logger.log('- Limit:', limit)
  logger.log('- Is there more data after this?', result.end ? 'no' : 'yes')
  logger.log('')

  const options = {
    columns: [
      { field: 'type', name: colors.cyan('Ecosystem') },
      { field: 'namespace', name: colors.cyan('Namespace') },
      { field: 'name', name: colors.cyan('Name') },
      { field: 'version', name: colors.cyan('Version') },
      { field: 'repository', name: colors.cyan('Repository') },
      { field: 'branch', name: colors.cyan('Branch') },
      { field: 'direct', name: colors.cyan('Direct') },
    ],
  }

  logger.log(chalkTable(options, result.rows))
}
