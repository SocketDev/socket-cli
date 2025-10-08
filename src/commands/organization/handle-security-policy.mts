/** @fileoverview Organization security policy business logic handler for Socket CLI. Orchestrates security policy retrieval and delegates to output formatter with policy settings and configuration. */

import { fetchSecurityPolicy } from './fetch-security-policy.mts'
import { outputSecurityPolicy } from './output-security-policy.mts'

import type { OutputKind } from '../../types.mts'

export async function handleSecurityPolicy(
  orgSlug: string,
  outputKind: OutputKind,
): Promise<void> {
  const result = await fetchSecurityPolicy(orgSlug)

  if (result.ok) {
    await outputSecurityPolicy(result.data, outputKind)
  } else {
    throw new Error(result.message || 'Failed to fetch security policy')
  }
}
