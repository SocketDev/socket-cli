import { fetchDeleteOrgFullScan } from './organization-full-scan-deletion-data.mts'
import { outputDeleteScan } from './output-delete-scan.mts'

import type { OutputKind } from '../../types.mts'

export async function handleDeleteScan(
  orgSlug: string,
  scanId: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchDeleteOrgFullScan(orgSlug, scanId, {
    commandPath: 'socket scan del',
  })

  await outputDeleteScan(data, outputKind)
}
