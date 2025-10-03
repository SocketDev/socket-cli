/** @fileoverview Organization dependencies business logic handler for Socket CLI. Orchestrates dependency retrieval and delegates to output formatter with organization dependency data. */

import { fetchDependencies } from './fetch-dependencies.mts'
import { outputDependencies } from './output-dependencies.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

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
