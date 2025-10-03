/** @fileoverview Scan view handler for Socket CLI. Orchestrates scan detail viewing by fetching scan artifacts and delegating to output formatter. Supports file filtering. */

import { fetchScan } from './fetch-scan.mts'
import { outputScanView } from './output-scan-view.mts'

import type { OutputKind } from '../../types.mts'

export async function handleScanView(
  orgSlug: string,
  scanId: string,
  filePath: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchScan(orgSlug, scanId)

  await outputScanView(data, orgSlug, scanId, filePath, outputKind)
}
