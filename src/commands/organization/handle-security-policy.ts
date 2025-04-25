import { fetchSecurityPolicy } from './fetch-security-policy'
import { outputSecurityPolicy } from './output-security-policy'

import type { OutputKind } from '../../types'

export async function handleSecurityPolicy(
  orgSlug: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchSecurityPolicy(orgSlug)
  if (!data) {
    return
  }

  await outputSecurityPolicy(data, outputKind)
}
