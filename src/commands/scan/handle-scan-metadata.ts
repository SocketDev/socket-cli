import { fetchScanMetadata } from './fetch-scan-metadata'
import { outputScanMetadata } from './output-scan-metadata'

export async function handleOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  outputKind: 'json' | 'markdown' | 'text'
): Promise<void> {
  const data = await fetchScanMetadata(orgSlug, scanId)
  if (!data) {
    return
  }

  await outputScanMetadata(data, scanId, outputKind)
}
