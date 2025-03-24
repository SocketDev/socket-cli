import { fetchScan } from './fetch-scan'
import { outputScanView } from './output-scan-view'

export async function handleScanView(
  orgSlug: string,
  scanId: string,
  filePath: string
): Promise<void> {
  const data = await fetchScan(orgSlug, scanId)
  if (!data) return

  await outputScanView(data, orgSlug, scanId, filePath)
}
