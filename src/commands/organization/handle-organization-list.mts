import { fetchOrganization } from './fetch-organization-list.mts'
import { outputOrganizationList } from './output-organization-list.mts'

import type { OutputKind } from '../../types.mts'

export async function handleOrganizationList(
  outputKind: OutputKind = 'text'
): Promise<void> {
  const data = await fetchOrganization()

  await outputOrganizationList(data, outputKind)
}
