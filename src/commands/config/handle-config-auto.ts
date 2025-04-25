import { discoverConfigValue } from './discover-config-value'
import { outputConfigAuto } from './output-config-auto'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

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
