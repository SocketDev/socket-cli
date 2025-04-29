import { fetchLicensePolicy } from './fetch-license-policy'
import { outputLicensePolicy } from './output-license-policy'

import type { OutputKind } from '../../types'

export async function handleLicensePolicy(
  orgSlug: string,
  outputKind: OutputKind
): Promise<void> {
  const data = await fetchLicensePolicy(orgSlug)

  await outputLicensePolicy(data, outputKind)
}
