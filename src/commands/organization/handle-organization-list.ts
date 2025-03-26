import { fetchOrganization } from './fetch-organization-list'
import { outputOrganizationList } from './output-organization-list'

export async function handleOrganizationList(
  outputKind: 'text' | 'json' | 'markdown' = 'text'
): Promise<void> {
  const data = await fetchOrganization()
  if (!data) {
    return
  }

  await outputOrganizationList(data, outputKind)
}
