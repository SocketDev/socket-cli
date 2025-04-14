import { fetchDiffScan } from './fetch-diff-scan'
import { outputDiffScan } from './output-diff-scan'

export async function handleDiffScan({
  depth,
  file,
  id1,
  id2,
  orgSlug,
  outputKind
}: {
  depth: number
  file: string
  id1: string
  id2: string
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'text'
}): Promise<void> {
  const data = await fetchDiffScan({
    id1,
    id2,
    orgSlug
  })
  if (!data) {
    return
  }

  await outputDiffScan(data, {
    depth,
    file,
    outputKind
  })
}
