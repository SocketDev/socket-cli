import { outputConfigUnset } from './output-config-unset.mts'
import { updateConfigValue } from '../../utils/config.mts'

import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigUnset({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const updateResult = updateConfigValue(key, undefined)

  await outputConfigUnset(updateResult, outputKind)
}
