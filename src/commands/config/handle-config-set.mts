import { outputConfigSet } from './output-config-set.mts'
import { updateConfigValue } from '../../utils/config.mts'

import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function handleConfigSet({
  key,
  outputKind,
  value,
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
  value: string
}) {
  const result = updateConfigValue(key, value)

  await outputConfigSet(result, outputKind)
}
