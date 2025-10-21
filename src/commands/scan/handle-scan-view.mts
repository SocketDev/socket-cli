import type { OutputKind } from '../../types.mts'
import { fetchScan } from './fetch-scan.mts'
import { outputScanView } from './output-scan-view.mts'

export async function handleScanView(
  orgSlug: string,
  scanId: string,
  filePath: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchScan(orgSlug, scanId)

  await outputScanView(data, orgSlug, scanId, filePath, outputKind)
}
