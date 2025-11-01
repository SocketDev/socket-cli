import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

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
    getDefaultLogger().log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
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
  getDefaultLogger().log(mdHeader('Organization dependencies'))
  getDefaultLogger().log('')
  getDefaultLogger().log('Request details:')
  getDefaultLogger().log('- Offset:', offset)
  getDefaultLogger().log('- Limit:', limit)
  getDefaultLogger().log(
    '- Is there more data after this?',
    result.end ? 'no' : 'yes',
  )
  getDefaultLogger().log('')

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

  getDefaultLogger().log(chalkTable(options, result.rows))
}
