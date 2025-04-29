import { fetchOrganization } from './fetch-organization-list'
import { outputOrganizationList } from './output-organization-list'

import type { OutputKind } from '../../types'

export async function handleOrganizationList(
  outputKind: OutputKind = 'text'
): Promise<void> {
  const data = await fetchOrganization()

  await outputOrganizationList(data, outputKind)
}
