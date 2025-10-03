/** @fileoverview Config auto business logic handler for Socket CLI. Orchestrates config value discovery and delegates to output formatter with optional persistence. */

import { discoverConfigValue } from './discover-config-value.mts'
import { outputConfigAuto } from './output-config-auto.mts'

import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigAuto({
  key,
  outputKind,
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const result = await discoverConfigValue(key)

  await outputConfigAuto(key, result, outputKind)
}
