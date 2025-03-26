import { fetchDiffScan } from './fetch-diff-scan'
import { outputDiffScan } from './output-diff-scan'

export async function handleDiffScan({
  after,
  before,
  depth,
  file,
  orgSlug,
  outputKind
}: {
  after: string
  before: string
  depth: number
  file: string
  orgSlug: string
  outputKind: 'json' | 'markdown' | 'text'
}): Promise<void> {
  const data = await fetchDiffScan({
    after,
    before,
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
