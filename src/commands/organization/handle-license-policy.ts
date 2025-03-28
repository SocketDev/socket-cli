import { fetchLicensePolicy } from './fetch-license-policy'
import { outputLicensePolicy } from './output-license-policy'

export async function handleLicensePolicy(
  orgSlug: string,
  outputKind: 'text' | 'json' | 'markdown'
): Promise<void> {
  const data = await fetchLicensePolicy(orgSlug)
  if (!data) {
    return
  }

  await outputLicensePolicy(data, outputKind)
}
