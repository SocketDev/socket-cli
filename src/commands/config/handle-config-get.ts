import { outputConfigGet } from './output-config-get'
import { getConfigValue, isReadOnlyConfig } from '../../utils/config'

import type { OutputKind } from '../../types'
import type { LocalConfig } from '../../utils/config'

export async function handleConfigGet({
  key,
  outputKind
}: {
  key: keyof LocalConfig
  outputKind: OutputKind
}) {
  const value = getConfigValue(key)
  const readOnly = isReadOnlyConfig()

  await outputConfigGet(key, value, readOnly, outputKind)
}
