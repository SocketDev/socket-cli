import { outputConfigGet } from './output-config-get'
import { getConfigValue } from '../../utils/config'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function handleConfigGet({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const result = getConfigValue(key)

  await outputConfigGet(key, result, outputKind)
}
