import { fetchDeleteOrgFullScan } from './fetch-delete-org-full-scan'
import { outputDeleteScan } from './output-delete-scan'

export async function handleDeleteScan(
  orgSlug: string,
  scanId: string
): Promise<void> {
  const data = await fetchDeleteOrgFullScan(orgSlug, scanId)
  if (!data) {
    return
  }

  await outputDeleteScan(data)
}
