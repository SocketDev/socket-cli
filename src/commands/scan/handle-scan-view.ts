import { fetchScan } from './fetch-scan'
import { outputScanView } from './output-scan-view'

import type { OutputKind } from '../../types'

export async function handleScanView(
  orgSlug: string,
  scanId: string,
  filePath: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchScan(orgSlug, scanId)

  await outputScanView(data, orgSlug, scanId, filePath, outputKind)
}
