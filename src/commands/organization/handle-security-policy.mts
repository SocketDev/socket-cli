import type { OutputKind } from '../../types.mts'
import { fetchSecurityPolicy } from './fetch-security-policy.mts'
import { outputSecurityPolicy } from './output-security-policy.mts'

export async function handleSecurityPolicy(
  orgSlug: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchSecurityPolicy(orgSlug)

  await outputSecurityPolicy(data, outputKind)
}
