import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'

import { fetchDependencies } from './dependencies-data.mts'
import { outputDependencies } from './output-dependencies.mts'

import type { OutputKind } from '../../types.mts'

export async function handleDependencies({
  limit,
  offset,
  purls,
  outputKind,
}: {
  limit: number
  offset: number
  purls: string[] | undefined
  outputKind: OutputKind
}): Promise<void> {
  debug(`Fetching dependencies with limit=${limit}, offset=${offset}`)
  debugDir({ limit, offset, purls, outputKind })

  const result = await fetchDependencies(
    { limit, offset, purls },
    {
      commandPath: 'socket organization dependencies',
    },
  )

  debug(`Dependencies ${result.ok ? 'fetched successfully' : 'fetch failed'}`)
  debugDir({ result })

  await outputDependencies(result, { limit, offset, outputKind })
}
