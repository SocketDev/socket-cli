import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'

import { fetchOrganization } from './fetch-organization-list.mts'
import { outputOrganizationList } from './output-organization-list.mts'

import type { OutputKind } from '../../types.mts'

export async function handleOrganizationList(
  outputKind: OutputKind = 'text',
): Promise<void> {
  debugFn('notice', 'Fetching organization list')
  debugDir('inspect', { outputKind })

  const data = await fetchOrganization()

  debugFn(
    'notice',
    `Organization list ${data.ok ? 'fetched successfully' : 'fetch failed'}`,
  )
  debugDir('inspect', { data })

  await outputOrganizationList(data, outputKind)
}
