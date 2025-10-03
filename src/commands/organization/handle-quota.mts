/** @fileoverview Organization quota business logic handler for Socket CLI. Orchestrates quota data retrieval and delegates to output formatter with quota limits and usage statistics. */

import { fetchQuota } from './fetch-quota.mts'
import { outputQuota } from './output-quota.mts'

import type { OutputKind } from '../../types.mts'

export async function handleQuota(
  outputKind: OutputKind = 'text',
): Promise<void> {
  const data = await fetchQuota()

  await outputQuota(data, outputKind)
}
