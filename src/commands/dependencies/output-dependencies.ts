// @ts-ignore
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputDependencies(
  data: SocketSdkReturnType<'searchDependencies'>['data'],
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
  if (outputKind === 'json') {
    let json
    try {
      json = JSON.stringify(data, null, 2)
    } catch (e) {
      process.exitCode = 1
      logger.fail(
        'There was a problem converting the data to JSON, please try without the `--json` flag'
      )
      return
    }

    logger.log(json)
    return
  }

  logger.log(
    'Request details: Offset:',
    offset,
    ', limit:',
    limit,
    ', is there more data after this?',
    data.end ? 'no' : 'yes'
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

  logger.log(chalkTable(options, data.rows))
}
