import type { OutputKind } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'
import { getConfigValue } from '../../utils/config.mts'
import { outputConfigGet } from './output-config-get.mts'

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
