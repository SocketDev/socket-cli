import { debug, debugDir } from '@socketsecurity/lib/debug'

import { fetchDependencies } from './fetch-dependencies.mts'
import { outputDependencies } from './output-dependencies.mts'

import type { OutputKind } from '../../types.mts'

export async function handleDependencies({
  limit,
  offset,
  outputKind,
}: {
  limit: number
  offset: number
  outputKind: OutputKind
}): Promise<void> {
  debug(`Fetching dependencies with limit=${limit}, offset=${offset}`)
  debugDir({ limit, offset, outputKind })

  const result = await fetchDependencies(
    { limit, offset },
    {
      commandPath: 'socket organization dependencies',
    },
  )

  debug(`Dependencies ${result.ok ? 'fetched successfully' : 'fetch failed'}`)
  debugDir({ result })

  await outputDependencies(result, { limit, offset, outputKind })
}
