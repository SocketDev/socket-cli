import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

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
  debugFn(
    'notice',
    `Fetching dependencies with limit=${limit}, offset=${offset}`,
  )
  debugDir('inspect', { limit, offset, outputKind })

  const result = await fetchDependencies({ limit, offset })

  debugFn(
    'notice',
    `Dependencies ${result.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir('inspect', { result })

  await outputDependencies(result, { limit, offset, outputKind })
}
