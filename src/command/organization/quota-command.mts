import { fetchQuota } from './quota-data.mts'
import { outputQuota } from './output-quota.mts'

import type { OutputKind } from '../../types.mts'

export async function handleQuota(
  outputKind: OutputKind = 'text',
): Promise<void> {
  const data = await fetchQuota()

  await outputQuota(data, outputKind)
}
