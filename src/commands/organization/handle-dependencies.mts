import { debug, debugDir } from '@socketsecurity/lib/debug'
import type { OutputKind } from '../../types.mts'
import { fetchDependencies } from './fetch-dependencies.mts'
import { outputDependencies } from './output-dependencies.mts'

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

  const result = await fetchDependencies({ limit, offset })

  debug(`Dependencies ${result.ok ? 'fetched successfully' : 'fetch failed'}`)
  debugDir({ result })

  await outputDependencies(result, { limit, offset, outputKind })
}
