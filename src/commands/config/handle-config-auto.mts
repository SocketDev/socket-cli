import { discoverConfigValue } from './discover-config-value.mts'
import { outputConfigAuto } from './output-config-auto.mts'

import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigAuto({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const result = await discoverConfigValue(key)

  await outputConfigAuto(key, result, outputKind)
}
