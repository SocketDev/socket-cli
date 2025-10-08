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

  // TODO: Get orgSlug from config or context
  const orgSlug = 'default-org'
  const result = await fetchDependencies(orgSlug)

  debugFn(
    'notice',
    `Dependencies ${result.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir('inspect', { result })

  if (result.ok) {
    await outputDependencies(result.data, outputKind)
  } else {
    throw new Error(result.message || 'Failed to fetch dependencies')
  }
}
