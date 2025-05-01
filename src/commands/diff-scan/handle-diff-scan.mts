import { fetchDiffScan } from './fetch-diff-scan.mts'
import { outputDiffScan } from './output-diff-scan.mts'

import type { OutputKind } from '../../types.mts'

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
  outputKind: OutputKind
}): Promise<void> {
  const data = await fetchDiffScan({
    after,
    before,
    orgSlug
  })

  await outputDiffScan(data, {
    depth,
    file,
    outputKind
  })
}
