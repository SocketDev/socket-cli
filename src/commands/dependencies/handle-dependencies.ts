import { fetchDependencies } from './fetch-dependencies'
import { outputDependencies } from './output-dependencies'

import type { OutputKind } from '../../types'

export async function handleDependencies({
  limit,
  offset,
  outputKind
}: {
  limit: number
  offset: number
  outputKind: OutputKind
}): Promise<void> {
  const data = await fetchDependencies({ limit, offset })
  if (!data) {
    return
  }

  await outputDependencies(data, { limit, offset, outputKind })
}
