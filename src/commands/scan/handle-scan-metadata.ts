import { fetchScanMetadata } from './fetch-scan-metadata'
import { outputScanMetadata } from './output-scan-metadata'

import type { OutputKind } from '../../types'

export async function handleOrgScanMetadata(
  orgSlug: string,
  scanId: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchScanMetadata(orgSlug, scanId)

  await outputScanMetadata(data, scanId, outputKind)
}
