import { fetchDeleteOrgFullScan } from './fetch-delete-org-full-scan'
import { outputDeleteScan } from './output-delete-scan'

import type { OutputKind } from '../../types'

export async function handleDeleteScan(
  orgSlug: string,
  scanId: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchDeleteOrgFullScan(orgSlug, scanId)

  await outputDeleteScan(data, outputKind)
}
