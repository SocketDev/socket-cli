import type { OutputKind } from '../../types.mts'
import { fetchScanMetadata } from './fetch-scan-metadata.mts'
import { outputScanMetadata } from './output-scan-metadata.mts'

export async function handleOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchScanMetadata(orgSlug, scanId)

  await outputScanMetadata(data, scanId, outputKind)
}
