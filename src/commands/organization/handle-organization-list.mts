/** @fileoverview Organization list business logic handler for Socket CLI. Orchestrates organization list retrieval and delegates to output formatter with organization metadata. */

import { fetchOrganization } from './fetch-organization-list.mts'
import { outputOrganizationList } from './output-organization-list.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

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
