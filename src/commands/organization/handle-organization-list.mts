import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { fetchOrganization } from './fetch-organization-list.mts'
import { outputOrganizationList } from './output-organization-list.mts'

import type { OutputKind } from '../../types.mts'

export async function handleOrganizationList(
  outputKind: OutputKind = 'text',
): Promise<void> {
  debugFn('Fetching organization list')
  debugDir({ outputKind })

  const data = await fetchOrganization()

  debugFn(
    `Organization list ${data.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir({ data })

  await outputOrganizationList(data, outputKind)
}
