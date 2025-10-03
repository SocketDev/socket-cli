/** @fileoverview Organization security policy business logic handler for Socket CLI. Orchestrates security policy retrieval and delegates to output formatter with policy settings and configuration. */

import { fetchSecurityPolicy } from './fetch-security-policy.mts'
import { outputSecurityPolicy } from './output-security-policy.mts'

import type { OutputKind } from '../../types.mts'

export async function handleSecurityPolicy(
  orgSlug: string,
  outputKind: OutputKind,
): Promise<void> {
  const data = await fetchSecurityPolicy(orgSlug)

  await outputSecurityPolicy(data, outputKind)
}
