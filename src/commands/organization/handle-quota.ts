import { fetchQuota } from './fetch-quota'
import { outputQuota } from './output-quota'

export async function handleQuota(
  outputKind: 'text' | 'json' | 'markdown' = 'text'
): Promise<void> {
  const data = await fetchQuota()
  if (!data) return

  await outputQuota(data, outputKind)
}
