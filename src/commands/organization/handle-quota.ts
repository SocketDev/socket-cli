import { fetchQuota } from './fetch-quota'
import { outputQuota } from './output-quota'

import type { OutputKind } from '../../types'

export async function handleQuota(
  outputKind: OutputKind = 'text'
): Promise<void> {
  const data = await fetchQuota()
  if (!data) {
    return
  }

  await outputQuota(data, outputKind)
}
