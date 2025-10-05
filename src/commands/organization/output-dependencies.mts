/** @fileoverview Organization dependencies output formatter for Socket CLI. Displays organization-wide dependency data in JSON, markdown, or text formats. Shows dependency usage statistics and metadata. */

// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputResult } from '../../utils/output.mts'

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
  outputResult(result, outputKind, {
    success: data => {
      outputMarkdown(data, { limit, offset })
      return ''
    },
  })
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
