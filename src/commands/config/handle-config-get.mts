/** @fileoverview Config get business logic handler for Socket CLI. Retrieves configuration value by key and delegates to output formatter. */

import { outputConfigGet } from './output-config-get.mts'
import { getConfigValue } from '../../utils/config.mts'

import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigGet({
  key,
  outputKind,
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const result = getConfigValue(key)

  await outputConfigGet(key, result, outputKind)
}
