import { fetchDiffScan } from './fetch-diff-scan.mts'
import { outputDiffScan } from './output-diff-scan.mts'

import type { OutputKind } from '../../types.mts'

export async function handleDiffScan({
  depth,
  file,
  id1,
  id2,
  orgSlug,
  outputKind,
  strictBlocking,
}: {
  depth: number
  file: string
  id1: string
  id2: string
  orgSlug: string
  outputKind: OutputKind
  strictBlocking: boolean
}): Promise<void> {
  const data = await fetchDiffScan({
    id1,
    id2,
    orgSlug,
  })

  await outputDiffScan(data, {
    depth,
    file,
    outputKind,
    strictBlocking,
  })
}
