import { fetchDeleteOrgFullScan } from './fetch-delete-org-full-scan.mts'
import { outputDeleteScan } from './output-delete-scan.mts'

import type { OutputKind } from '../../types.mts'

export async function handleDeleteScan(
  orgSlug: string,
  scanId: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchDeleteOrgFullScan(orgSlug, scanId)

  await outputDeleteScan(data, outputKind)
}
