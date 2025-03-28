import { fetchSecurityPolicy } from './fetch-security-policy'
import { outputSecurityPolicy } from './output-security-policy'

export async function handleSecurityPolicy(
  orgSlug: string,
  outputKind: 'text' | 'json' | 'markdown'
): Promise<void> {
  const data = await fetchSecurityPolicy(orgSlug)
  if (!data) {
    return
  }

  await outputSecurityPolicy(data, outputKind)
}
