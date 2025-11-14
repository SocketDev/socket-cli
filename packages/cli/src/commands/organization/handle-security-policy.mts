import { fetchSecurityPolicy } from './fetch-security-policy.mts'
import { outputSecurityPolicy } from './output-security-policy.mts'

import type { OutputKind } from '../../types.mts'

export async function handleSecurityPolicy(
  orgSlug: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchSecurityPolicy(orgSlug, {
    commandPath: 'socket organization policy security',
  })

  await outputSecurityPolicy(data, outputKind)
}
