/** @fileoverview Organization license policy business logic handler for Socket CLI. Orchestrates license policy retrieval and delegates to output formatter with policy configuration data. */

import { fetchLicensePolicy } from './fetch-license-policy.mts'
import { outputLicensePolicy } from './output-license-policy.mts'

import type { OutputKind } from '../../types.mts'

export async function handleLicensePolicy(
  orgSlug: string,
  outputKind: OutputKind,
): Promise<void> {
  const result = await fetchLicensePolicy(orgSlug)

  if (result.ok) {
    await outputLicensePolicy(result.data, outputKind)
  } else {
    throw new Error(result.message || 'Failed to fetch license policy')
  }
}
